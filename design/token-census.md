# Design-token census — Axal VC platform

Integration plan §16 step 3. Read-only pass over the canvas corpus; no repo source was modified.

- **Corpus**: `/home/user/StudioOS/Axal VC platform/*.dc.html` — **107 canvases**, top level only.
  `uploads/`, `scraps/`, `assets/`, and the two `*-standalone.html` pitch-deck files were excluded.
- **Method**: per-canvas distinct-value extraction from both `<style>` blocks **and** inline
  `style="…"` attributes (the majority of tokens live inline), aggregated to a *canvas count*.
  Occurrence counts are also given because canvas count alone hides intensity of use.
- **Machine-readable output**: `/home/user/StudioOS/design/tokens/tokens.json`

---

## 0. Headline finding — there is a token spec canvas, and there are two design generations

**`Axal VC platform/System Sheet.dc.html` is a self-describing design-token sheet.** Its
`System · Tokens` artboard declares the palette, type scale, radius scale and spacing scale as
literal JS constants (lines 315–365):

```js
const INK = '#241f38', MUT = '#6b6577', FAINT = '#8b8798', HAIR = '#e8e6ee';
const V   = '#7c3aed', VD  = '#6d28d9', VT    = '#f4f0fe';
const AM  = '#fcd34d', AMD = '#92400e', RED   = '#b91c1c';
const RADII = [['7px','Inputs, small chips'],['9px','Buttons'],['10px','Inner cards'],
               ['12px','Blocks'],['16px','Outer cards'],['99px','Pills, avatars']];
const SPACE = [['4','Icon to label'],['7','Chip gaps'],['11','Within a card'],
               ['14','Between cards'],['20','Section gaps'],['30','Frame padding']];
```

**The claimed baseline in the integration plan is a verbatim transcription of this file.** That
resolves the reconciliation question: the baseline is not a guess, it is the authored spec.

But the spec is only fully implemented by a small family of canvases. The corpus splits into at
least two generations:

| | **Spec family ("violet-ink")** | **Legacy family ("zinc-ink")** |
|---|---|---|
| Ink | `#241f38` | `#18181b` / `#1a202c` |
| Hairline | `#e8e6ee` | `#ececf1` |
| Ground | `#f4f3f7` (page `#eeedf2`) | `#f8f8fa` / `#faf9fc` |
| Muted | `#6b6577` | `#615c6e` / `#3f3f46` / `#71717a` |
| Frame | `width:1080px; min-width:1080px` | `width:1440px; min-width:1440px` (27 canvases) |
| Labels | Roboto Mono 500 / 10px / `.11em` | Inter 600–800 / 9.5–11px / `.07em` |
| Canvases | **7–8** | ~99 |

Spec-family canvases (all seven declare a hard 1080px frame; `Emails.dc.html` shares the label
class but not the frame):
`System Sheet`, `Pricing`, `Apply and Status`, `Auth and Onboarding`, `Events`, `Help Center`,
`Notifications`, (+ `Emails`).

The violet ink `#241f38` also appears in 6 further canvases (`Data Room`, `Deal Flow`,
`Legal & Capital Engine`, `Navigation Shell`, `Network`, `Scoring Engine v2`) — 14 total — and
the violet-grey muted `#6b6577` reaches **31** canvases, so the newer language is spreading.

**Decision recorded in `tokens.json`:** the spec value is the token `value`; the frequency
majority is carried alongside as `majority` with its counts. Rationale: pure frequency measures
how many *old* canvases exist, not intent, and the plan's baseline is the spec verbatim. Every
place where frequency would have chosen differently is listed in §3 below.

---

## 1. Frequency-counted census

### 1.1 Colours — 501 distinct hex literals; 128 in ≥10 canvases; 72 in ≥20

Three literals were false positives from `href="#…"` fragments and are excluded: `#f10`, `#4192`,
`#1042` (1 canvas each). All others are 6-digit, plus `#fff`.

| hex | canvases | occurrences |
|---|---|---|
| `#fff` | 107 | 1883 |
| `#ececf1` | 91 | 783 |
| `#6d28d9` | 81 | 655 |
| `#18181b` | 80 | 451 |
| `#7c3aed` | 73 | 795 |
| `#b45309` | 70 | 396 |
| `#b91c1c` | 68 | 281 |
| `#92400e` | 67 | 309 |
| `#f8f8fa` | 52 | 103 |
| `#0f766e` | 51 | 161 |
| `#047857` | 51 | 338 |
| `#fffbeb` | 50 | 178 |
| `#3f3f46` | 50 | 307 |
| `#fde68a` | 48 | 268 |
| `#faf9fc` | 47 | 154 |
| `#fef2f2` | 45 | 128 |
| `#f4f3f7` | 45 | 187 |
| `#ecfdf5` | 45 | 185 |
| `#fecaca` | 44 | 164 |
| `#615c6e` | 42 | 1089 |
| `#4a4553` | 40 | 327 |
| `#c4b5fd` | 38 | 134 |
| `#1d4ed8` | 38 | 106 |
| `#e2e1e8` | 37 | 116 |
| `#a7f3d0` | 37 | 224 |
| `#f4f4f6` | 36 | 157 |
| `#f1f0f5` | 36 | 95 |
| `#fbfbfc` | 35 | 202 |
| `#71717a` | 34 | 517 |
| `#3f3a49` | 34 | 330 |
| `#f0eff4` | 33 | 178 |
| `#fcd34d` | 32 | 51 |
| `#eceaf2` | 32 | 51 |
| `#e4e4e8` | 31 | 90 |
| `#6b6577` | 31 | 304 |
| `#52525b` | 29 | 225 |
| `#334155` | 29 | 117 |
| `#f59e0b` | 28 | 37 |
| `#d97706` | 28 | 75 |
| `#a1a1aa` | 28 | 693 |
| `#15803d` | 28 | 268 |
| `#1a202c` | 27 | 144 |
| `#ffffff` | 26 | 47 |
| `#d4d4d8` | 26 | 49 |
| `#fffdf5` | 25 | 60 |
| `#f4f4f5` | 25 | 243 |
| `#f0fdfa` | 25 | 30 |
| `#eff6ff` | 25 | 34 |
| `#c7d2fe` | 25 | 86 |
| `#dcfce7` | 24 | 123 |
| `#d4d2dc` | 24 | 35 |
| `#be185d` | 24 | 55 |
| `#99f6e4` | 24 | 42 |
| `#f5f5ff` | 23 | 70 |
| `#ede9fe` | 23 | 137 |
| `#4338ca` | 23 | 81 |
| `#3730a3` | 23 | 61 |
| `#fef3c7` | 22 | 51 |
| `#f5f3ff` | 22 | 115 |
| `#e8e8ec` | 22 | 34 |
| `#dc2626` | 22 | 53 |
| `#4f46e5` | 22 | 68 |
| `#e8e6ee` | 21 | 150 |
| `#e4e4e7` | 21 | 152 |
| `#f2f1f5` | 20 | 95 |
| `#dcd9e4` | 20 | 27 |
| `#a8a4b4` | 20 | 54 |
| `#6ee7b7` | 20 | 33 |
| `#2a2833` | 20 | 167 |
| `#1d1b25` | 20 | 56 |
| `#17161d` | 20 | 26 |
| `#0e7490` | 20 | 53 |

**Role split** (same colour counted per CSS property it appears in):

| role | top values (canvases / occurrences) |
|---|---|
| `color:` | `#fff` 98/603 · `#18181b` 80/264 · `#6d28d9` 58/… · `#3f3f46` 49 · `#615c6e` 42/932 · `#7c3aed` 39 · `#92400e` 36 · `#71717a` 34 · `#3f3a49` 34 · `#b45309` 31 |
| `background:` | `#fff` 90/1100 · `#7c3aed` 59/278 · `#f8f8fa` 52/80 · `#faf9fc` 47/147 · `#fbfbfc` 35/187 · `#18181b` 31 · `#fffbeb` 28 · `#eceaf2` 27 · `#f4f4f6` 26 |
| `border*:` | `#ececf1` 71/639 · `#7c3aed` 42 · `#f4f3f7` 41/121 · `#fde68a` 39/97 · `#e2e1e8` 37/110 · `#fff` 32 · `#fecaca` 29 · `#f0eff4` 23 · `#e8e6ee` 18/129 |

**Alpha (rgba) forms** — the ink colours also exist as translucent overlays:
`rgba(24,24,27,α)` in **72** canvases (α ∈ {.03 .04 .07 .08 .12 .14 .55 .6}) vs
`rgba(36,31,56,α)` in **8** (the spec family; α ∈ {.07 .08 .55 .58}).
`rgba(124,58,237,α)` in **43** canvases (α ∈ {.05 .1 .12}).

### 1.2 Fonts

| stack | canvases |
|---|---|
| `Inter,system-ui,sans-serif` | 99 |
| `'Roboto Mono',ui-monospace,monospace` | 47 |
| `ui-monospace,Menlo,monospace` | 24 |
| `'Roboto Mono',monospace` (incl. escaped `\'Roboto Mono\'`) | 13 |
| `'Inter',system-ui,sans-serif` | 7 |
| `'Instrument Serif',Georgia,serif` | 3 |
| `Inter,sans-serif` | 2 |
| `Inter,-apple-system,'Segoe UI',Arial,sans-serif` | 1 |
| `'Mrs Saint Delafield',cursive` | 1 |

**Family reach**: Inter **107/107**. Roboto Mono **54/107**. Space Grotesk **0/107**.
Roboto Mono is always paired with `font-variant-numeric:tabular-nums` — it is the
data/figures/label face exactly as the baseline claims.

**Webfont links actually requested by the canvases:**

| href | canvases |
|---|---|
| `…family=Inter:wght@400;500;600;700;800&display=swap` | 36 |
| `…family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500;600;700&display=swap` | 25 |
| `…family=Inter:…&family=Roboto+Mono:wght@500;600&display=swap` | 11 |
| `…family=Inter:…&family=Roboto+Mono:wght@400;500;700&display=swap` | 7+1 |
| `…family=Inter:…&family=Roboto+Mono:wght@400;500;600&display=swap` | 6 |
| `…family=Inter:wght@400;…;800;900&display=swap` | 5 |
| `…;900&family=Roboto+Mono:wght@400;500;600;700&display=swap` | 3 |
| variants adding `Instrument+Serif` / `DM+Sans` / `Mrs+Saint+Delafield` | 5 |

⇒ **union axes: Inter `400;500;600;700;800` (900 in only 12 canvases) and Roboto Mono `400;500;600;700`.**

### 1.3 Font sizes — 70 distinct values (all px, no rem anywhere)

| px | canvases | | px | canvases | | px | canvases |
|---|---|---|---|---|---|---|---|
| 11 | 107 | | 15 | 64 | | 24 | 24 |
| 12 | 105 | | 19 | 50 | | 23 | 24 |
| 10.5 | 103 | | 17 | 47 | | 21 | 19 |
| 11.5 | 101 | | 20 | 46 | | 30 | 10 |
| 12.5 | 98 | | 22 | 39 | | 16.5 | 10 |
| 10 | 98 | | 8.5 | 35 | | 8 / 29 / 28 | 8 |
| 13 | 94 | | 14.5 | 32 | | 27 / 25 | 7 |
| 9.5 | 85 | | 18 | 29 | | 32 | 6 |
| 14 | 77 | | 26 | 28 | | 34 | 5 |
| 13.5 | 74 | | 15.5 | 28 | | 40 / 38 | 4 |
| 9 | 67 | | | | | 64 | 3 |
| 16 | 65 | | | | | 76 / 58 / 54 / 52 / 42 / 35 / 33 | 2 |

The corpus uses a **0.5px-granular ramp**, not a discrete scale. The spec's 7-step scale
(23 / 16 / 14.5 / 14.5 / 12.5 / 13.5 / 10) is a subset; 14.5px (32 canvases) and 23px (24) are
the spec-only sizes, with 14px (77) and 19px (50) as the corpus-wide alternatives.

### 1.4 Font weights

| weight | canvases | note |
|---|---|---|
| 800 | 107 | all headings |
| 700 | 107 | primary buttons, mono data |
| 600 | 100 | quiet buttons, secondary emphasis |
| 400 | 42 | 6 via `font-weight:400`, 36 via `font:400 …` shorthand |
| 500 | 27 | mono uppercase labels |
| 900 | 6 | marketing hero display only |

### 1.5 Letter-spacing — 39 distinct values

| value | canvases | | value | canvases |
|---|---|---|---|---|
| `-.02em` | 96 | | `-.025em` | 30 |
| `-.01em` | 84 | | `.04em` | 26 |
| `-.015em` | 72 | | `-.03em` | 22 |
| `.07em` | 63 | | `-.022em` | 17 |
| `.09em` | 58 | | `.11em` | 16 |
| `.05em` | 50 | | `.1em` | 14 |
| `.08em` | 45 | | `-.024em` | 14 |
| `.06em` | 33 | | `-.012em` | 13 |

Tail (≤10 canvases): `-.028em` 10 · `-.018em` 9 · `-.014em` 9 · `-.026em` 8 · `.03em` 7 ·
`-.04em` 7 · `-.035em` 7 · `.13em` 5 · `.02em` 4 · `-.032em` 4 · `-.008em` 4 · `.14em` 3 ·
`-.016em` 3 · `.16em` 2 · `.2em` 1 · `.28em` 1.

**Co-located with `font-weight:800`** (i.e. actual heading tracking):
`-.02em` **92 canvases / 252 occurrences** — the clear winner · `-.015em` 70/143 ·
`-.01em` 55/77 · `-.025em` 30/96.

### 1.6 Border radius — 40 distinct values

| value | canvases | | value | canvases |
|---|---|---|---|---|
| `9px` | 91 | | `5px` | 62 |
| `50%` | 87 | | `16px` | 59 |
| `12px` | 85 | | `999px` | 57 |
| `11px` | 82 | | `99px` | 50 |
| `7px` | 77 | | `14px` | 50 |
| `10px` | 76 | | `3px` | 46 |
| `8px` | 72 | | `4px` | 39 |
| | | | `6px` | 37 |

Tail: `18px` 32 · `13px` 23 · `2px` 12 · `20px` 8 · `15px` 6 · `22px` 4 · plus ~19 asymmetric
shorthands (`0 0 3px 3px` in 21 canvases — the violet top-rule; `3px 3px 0 0` in 4; etc.).

### 1.7 Spacing — no discrete scale exists

Every integer 1–30px is in use. Top values across `padding` / `margin` / `gap`:

| px | canvases | occurrences | | px | canvases | occurrences |
|---|---|---|---|---|---|---|
| 12 | 99 | 1956 | | 20 | 95 | 921 |
| 8 | 107 | 1702 | | 13 | 104 | 852 |
| 10 | 107 | 1672 | | 22 | 97 | 811 |
| 14 | 107 | 1550 | | 18 | 94 | 765 |
| 11 | 105 | 1546 | | 2 | 102 | 650 |
| 9 | 106 | 1526 | | 4 | 104 | 606 |
| 6 | 104 | 1359 | | 3 | 104 | 590 |
| 16 | 95 | 1265 | | 15 | 87 | 467 |
| 7 | 107 | 1004 | | 24 | 93 | 416 |
| 5 | 104 | 946 | | 17 | 61 | 374 |

Most common `gap` values: 10px (105) · 8px (104) · 7px (100) · 12px (95) · 14px (93) · 11px (92).
Most common `padding` shorthands: `6px 12px` (52) · `5px 11px` (48) · `3px 9px` (44) ·
`2px 7px` (43) · `13px 15px` (43) · `11px 13px` (40).

### 1.8 Uppercase labels

`text-transform:uppercase` appears in **106/107** canvases.

| co-located font-size | canvases | occurrences |
|---|---|---|
| 10px | 69 | 172 |
| 9.5px | 47 | 84 |
| 11px | 36 | 169 |
| 10.5px | 31 | 89 |
| 9px | 22 | 59 |

| co-located letter-spacing | canvases | occurrences |
|---|---|---|
| `.09em` | 57 | 70 |
| `.07em` | 57 | **175** |
| `.08em` | 43 | 79 |
| `.06em` | 21 | 49 |
| `.05em` | 16 | 66 |
| `.11em` | 15 | 41 |

Only **7 canvases** put the uppercase label on Roboto Mono in a shared CSS rule (the spec family:
`System Sheet`, `Apply and Status`, `Auth and Onboarding`, `Emails`, `Events`, `Help Center`,
`Notifications`). Everywhere else the uppercase label is Inter 600–800.

### 1.9 Canvas width

| pattern | canvases |
|---|---|
| `width:1080px; min-width:1080px` (hard artboard frame) | **7** |
| `max-width:1080px` on a content column | 12 |
| `@media (max-width:1080px)` breakpoint only | 32 |
| no 1080px reference at all | 65 |
| `width:1440px; min-width:1440px` (competing artboard frame) | **27** |
| `min-width:1536px` | 12 |
| `max-width:1000px` (content cap, not a frame) | 23 |

---

## 2. Reconciliation against the claimed baseline

| # | Baseline claim | Verdict | Real value & counts |
|---|---|---|---|
| 1 | ink `#241f38` | **CONFIRMED (minority)** | Exact literal present. 14 canvases / 48 occ; 8 canvases use it as `body{color:}`. Corpus majority ink is `#18181b` (80 canvases / 451 occ) with `#1a202c` third (27 / 144). |
| 2 | muted `#6b6577` | **CONFIRMED** | 31 canvases / 304 occ, 26 as `color:`. Competing muteds are more numerous individually (`#615c6e` 42, `#3f3f46` 50) but none is a single dominant "muted". |
| 3 | faint `#8b8798` | **CONFIRMED (minority)** | 13 canvases / 68 occ. Corpus favourite for the faint role is `#a1a1aa` (28 canvases / 693 occ). |
| 4 | borders `#e8e6ee` | **CONFIRMED (minority)** | 21 canvases / 150 occ, 18 in a `border` property. Corpus majority hairline is `#ececf1` (91 canvases / 783 occ, 71 as border). |
| 5 | ground `#ffffff` | **CONFIRMED** | 107/107. Written `#fff` (1883 occ) everywhere; long form `#ffffff` in 26 canvases (47 occ). The spec calls this *Surface*. |
| 6 | ground `#f4f3f7` | **CONFIRMED** | 45 canvases / 187 occ — but predominantly as a **border** (41 canvases) rather than a page ground (13). The page ground behind cards in the spec family is `#eeedf2` (10 canvases). Corpus-wide page ground is `#f8f8fa` (52 as `background`). |
| 7 | violet `#7c3aed` | **CONFIRMED** | 73 canvases / 795 occ. 59 as background, 42 as border, 39 as text. Also `rgba(124,58,237,α)` in 43. |
| 8 | deep `#6d28d9` | **CONFIRMED** | 81 canvases / 655 occ, 58 as `color:`. Highest-reach violet in the corpus. |
| 9 | lavender `#f4f0fe` | **CONFIRMED (minority)** | 11 canvases / 32 occ. Corpus favourite lavender tint is `#f5f3ff` (22 canvases) with `#ede9fe` (23) and `#f5f5ff` (23) close behind. |
| 10 | amber `#fcd34d` | **CONFIRMED** | 32 canvases / 51 occ. Low occurrence count matches the spec note "Badge fills only". |
| 11 | amber deep `#92400e` | **CONFIRMED** | 67 canvases / 309 occ, 36 as `color:`. Near-tie with `#b45309` (70 canvases / 396 occ), which the spec does not name. |
| 12 | font Inter | **CONFIRMED** | Referenced in 107/107. `Inter,system-ui,sans-serif` is the exact body stack in 99. |
| 13 | headings weight 800 | **CONFIRMED** | `font-weight:800` in 107/107. |
| 14 | heading letter-spacing `-0.02em` | **CONFIRMED** | 96 canvases overall; 92 canvases / 252 occ co-located with `font-weight:800` — the single most common heading tracking. |
| 15 | font Roboto Mono for data/labels | **CONFIRMED** | 54/107 canvases load it; always with `font-variant-numeric:tabular-nums`. Its two documented uses are 700/13.5px figures and 500/10px uppercase labels. |
| 16 | radius 7 | **CONFIRMED** | 77 canvases |
| 17 | radius 9–10 | **CONFIRMED** | `9px` 91 canvases (highest), `10px` 76 |
| 18 | radius 12 | **CONFIRMED** | 85 canvases |
| 19 | radius 16 | **CONFIRMED** | 59 canvases |
| 20 | radius 99 | **CONFIRMED (near-tie)** | `99px` 50 canvases vs the visually identical `999px` 57 canvases |
| 21 | uppercase 10–11px letterspaced labels | **CONFIRMED** | uppercase in 106/107; label sizes 10px (69) and 11px (36) lead. **Tracking DIFFERS**: spec says `.11em` (15 canvases), corpus default is `.07em` (57 canvases / 175 occ) and `.09em` (57 / 70). |
| 22 | 1080px canvas width | **DIFFERENT — qualified** | 1080px appears in 42 canvases, but only **7** use it as a hard artboard frame. 32 use it purely as a media-query breakpoint. A competing **1440px** artboard frame is used by **27** canvases. |

**Nothing in the claimed baseline was NOT FOUND.** Every literal exists in the corpus.

Baseline items whose *value* is right but whose *dominance* is not: ink, faint, borders,
lavender, the `.11em` label tracking, and the 1080px frame.

### Tokens the baseline omits but the spec canvas declares

| token | value | canvases |
|---|---|---|
| Lavender edge (tint borders) | `#ddd0fb` | 6 |
| Amber tint (caution blocks) | `#fffdf5` | 25 |
| Positive | `#047857` | 51 |
| Positive tint | `#eefbf5` | 6 |
| Destructive / error | `#b91c1c` | 68 |
| Error tint | `#fef2f2` | 45 |
| Frame + card radius | `14px` | 50 |
| Spacing scale | 4 / 7 / 11 / 14 / 20 / 30 | see §1.7 |
| Type scale | 23 / 16 / 14.5 / 12.5 / 13.5 / 10 | see §1.3 |

Note the spec's own frame radius is **14px**, which is *not* in its own declared RADII scale —
an internal inconsistency in the source file, not a transcription error.

### High-frequency tokens neither the baseline nor the spec names

`#b45309` (70) amber-alt · `#fde68a` (48) amber hairline · `#fecaca` (44) error hairline ·
`#a7f3d0` (37) positive hairline · `#1d4ed8` (38) info blue · `#0f766e` (51) teal ·
`#15803d` (28) green-alt · `#334155` (29) slate · `#be185d` (24) pink ·
`#4338ca`/`#3730a3`/`#4f46e5` (22–23) indigo. Radii `11px` (82) and `8px` (72) both outrank
`16px` from the spec scale.

---

## 3. Conflicts — competing values for one semantic role

Majority = highest canvas count. "Winner" column is the majority winner as required; the
adopted value is in `tokens.json` and is the spec value where they differ.

| role | competing values (canvases / occ) | majority winner | adopted | why |
|---|---|---|---|---|
| **Ink** | `#18181b` 80/451 · `#1a202c` 27/144 · `#241f38` 14/48 · `#141118` 3/33 | `#18181b` | `#241f38` | spec-declared + baseline; `#18181b` is Tailwind `zinc-900` carried over from the legacy generation |
| **Muted** | `#3f3f46` 50/307 · `#615c6e` 42/1089 · `#4a4553` 40/327 · `#71717a` 34/517 · `#3f3a49` 34/330 · `#6b6577` 31/304 · `#52525b` 29/225 | `#3f3f46` (by canvases) / `#615c6e` (by occurrences) | `#6b6577` | no true majority — six values within 20 canvases of each other; spec breaks the tie |
| **Faint** | `#a1a1aa` 28/693 · `#a8a4b4` 20/54 · `#a5a0b2` 15/38 · `#8b8798` 13/68 | `#a1a1aa` | `#8b8798` | spec-declared; `#a1a1aa` is Tailwind `zinc-400` |
| **Hairline** | `#ececf1` 91/783 · `#f4f3f7` 45/187 · `#e2e1e8` 37/116 · `#f0eff4` 33/178 · `#d4d2dc` 24/35 · `#e8e8ec` 22/34 · `#e8e6ee` 21/150 | **`#ececf1`** (decisive — 4.3× the adopted value) | `#e8e6ee` | spec-declared. **This is the largest single divergence in the census.** |
| **Page ground** | `#f8f8fa` 52/103 · `#faf9fc` 47/154 · `#f4f4f6` 36/157 · `#fbfbfc` 35/202 · `#eceaf2` 32/51 · `#f4f3f7` 13-as-bg/187 · `#eeedf2` 10/11 | `#f8f8fa` | `#f4f3f7` | spec-declared; note the spec family's *page* colour is actually `#eeedf2` and `#f4f3f7` is its *frame* fill |
| **Lavender tint** | `#ede9fe` 23/137 · `#f5f5ff` 23/70 · `#f5f3ff` 22/115 · `#faf7ff` 19/77 · `#f4f0fe` 11/32 | `#ede9fe`/`#f5f5ff` (tie at 23) | `#f4f0fe` | spec-declared; `#f5f3ff`/`#ede9fe` are Tailwind `violet-50`/`violet-100` |
| **Amber text** | `#b45309` 70/396 · `#92400e` 67/309 · `#78350f` 14/24 | `#b45309` (+3 canvases) | `#92400e` | spec-declared; margin is inside noise |
| **Amber tint** | `#fffbeb` 50/178 · `#fffdf5` 25/60 · `#fef3c7` 22/51 | `#fffbeb` | `#fffdf5` | spec-declared |
| **Positive tint** | `#ecfdf5` 45/185 · `#dcfce7` 24/123 · `#eefbf5` 6/14 | `#ecfdf5` | `#eefbf5` | spec-declared; the two are within 1% ΔE — consider adopting `#ecfdf5` instead |
| **Positive text** | `#047857` 51/338 · `#0f766e` 51/161 (teal) · `#15803d` 28/268 | `#047857`/`#0f766e` tie | `#047857` | spec-declared and highest occurrence |
| **Error text** | `#b91c1c` 68/281 · `#dc2626` 22/53 | `#b91c1c` | `#b91c1c` | **no conflict** |
| **Pill radius** | `999px` 57 · `99px` 50 | `999px` | `99px` | spec-declared; visually identical |
| **Label tracking** | `.07em` 57 canvases / **175 occ** · `.09em` 57/70 · `.08em` 43/79 · `.11em` 15/41 | `.07em` (ties on canvases, 2.5× on occurrences) | `.11em` | spec-declared. Recommend shipping **both**: `.11em` as `tracking-label` for mono labels and `.07em` as `tracking-label-tight` for the Inter uppercase labels the other 99 canvases use |
| **Label size** | `10px` 69 · `9.5px` 47 · `11px` 36 · `10.5px` 31 | `10px` | `10px` | agrees with spec |
| **Page-heading size** | `19px` 50 · `23px` 24 · `22px` 39 · `20px` 46 | `19px` | both | spec says 23px; ship 19px as well — it is the corpus default |
| **Card-title size** | `14px` 77 · `14.5px` 32 | `14px` | both | spec says 14.5px |
| **Artboard width** | `1440px` 27 (hard frame) · `1080px` 7 (hard frame) + 12 (max-width) | `1440px` | `1080px` | baseline + spec family; 1440px canvases are the legacy "Canvas"/"Pages ·"/"Admin ·" set |
| **Heading tracking** | `-.02em` 92/252 · `-.015em` 70/143 · `-.01em` 55/77 · `-.025em` 30/96 | `-.02em` | `-.02em` | **no conflict** — baseline and majority agree |

---

## 4. Gap vs. the existing Tailwind config

### 4.1 Where the config actually is

**There is no `tailwind.config.js` / `.cjs` / `.ts` anywhere in the repo.** The frontend is on
**Tailwind v4** (`tailwindcss ^4.0.0` + `@tailwindcss/vite ^4.3.3`, wired in
`/home/user/StudioOS/frontend/vite.config.js`), so the theme is declared **in CSS** via an
`@theme` block:

- **`/home/user/StudioOS/frontend/src/index.css`** — line 1 `@import` (Roboto Mono), line 2
  `@import "tailwindcss"`, line 16 `@theme { … }`, then ~480 lines of app-level CSS including
  `:root` / `[data-theme="dark"]` variable sets.

**Extend by adding declarations inside the existing `@theme` block at `index.css:16-31`.**
Do not create a `tailwind.config.js` — v4 would ignore it unless explicitly `@config`-ed.

### 4.2 What is already defined

Inside `@theme` (11 tokens, all colours — no font, radius, size, weight, tracking or spacing tokens exist):

| Tailwind token | value | matches a census token? |
|---|---|---|
| `--color-brand` | `#8b5cf6` | ✗ — `#8b5cf6` is in only 10 canvases |
| `--color-brand-light` | `#a78bfa` | ✗ — 14 canvases |
| `--color-brand-dark` | `#7c3aed` | **✓ = census `violet`** (73 canvases). Note the naming inversion: the census's *primary* violet is Tailwind's `brand-dark`. |
| `--color-surface` | `#111827` | ✗ — 1 canvas (this is a dark-UI surface, unrelated) |
| `--color-surface-light` | `#1f2937` | ✗ — not in the corpus |
| `--color-surface-lighter` | `#374151` | ✗ — not in the corpus |
| `--color-gvpn-ink` | `#0B0B12` | ✗ |
| `--color-gvpn-paper` | `#F6F5F0` | ✗ |
| `--color-gvpn-violet` | `#6D5BFF` | ✗ |
| `--color-gvpn-mint` | `#5DE0B8` | ✗ |
| `--color-gvpn-amber` | `#F2B33D` | ✗ |

Outside `@theme`, plain CSS variables on `:root` (not Tailwind utilities — they only drive the
app shell / theme flip): `--app-bg #f9fafb`, `--app-surface #ffffff`, `--app-surface-2 #f3f4f6`,
`--app-text #111827`, `--app-text-muted #6b7280`, `--app-border #e5e7eb`, `--app-input-*`,
`--app-scroll-*`. **None of these values appears in the canvas corpus** — they are default
Tailwind grays, not the Axal palette.

### 4.3 Gap summary

| category | already have | genuinely new |
|---|---|---|
| **color** | 1 of 24 (`#7c3aed` as `brand-dark`) | 23 — ink, muted, faint, hairline, ground, surface, violetDeep, lavender, lavenderEdge, amber, amberDeep, amberTint, amberEdge, positive, positiveTint, positiveEdge, destructive, destructiveTint, destructiveEdge, info, teal |
| **font** | 0 | all — `--font-sans` (Inter) and `--font-mono` (Roboto Mono). **`font-mono` is used 233× in `frontend/src` today and resolves to Tailwind's default `ui-monospace…` stack, not Roboto Mono.** |
| **radius** | 0 | all 11 |
| **fontSize** | 0 | all — the corpus is px-based, Tailwind's defaults are rem-based |
| **fontWeight** | 0 | all 6 (Tailwind's numeric defaults cover these, so this is optional) |
| **letterSpacing** | 0 | all 9 — Tailwind's `tracking-*` defaults (`-0.05/-0.025/0/0.025/0.05/0.1em`) do **not** contain `-0.02em`, `-0.015em`, `-0.01em`, `0.07em` or `0.11em` |
| **spacing** | Tailwind's 0.25rem ramp | the corpus is 1px-granular and does not map to it; recommend **not** overriding `--spacing` and instead using arbitrary values, or adding only the 6 spec steps as named tokens |

### 4.4 Font loading — the pattern Inter and Roboto Mono must copy

`/home/user/StudioOS/frontend/index.html` lines 175–183. Verbatim:

```html
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <!-- Load the display font WITHOUT blocking first paint. `media="print"` lets
       the browser fetch it at low priority; the onload swap flips it to `all`
       once ready. `display=swap` shows the system fallback until then, so the
       hero text paints immediately (helps mobile FCP/LCP). -->
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'" />
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" /></noscript>
```

Five parts: (1) `preconnect` to `fonts.googleapis.com`, (2) `preconnect` to `fonts.gstatic.com`
**with `crossorigin`**, (3) `<link rel="preload" as="style">`, (4) `<link rel="stylesheet">` with
`media="print" onload="this.media='all'"`, (5) `<noscript>` duplicate with no media attribute.
`&display=swap` on every href.

**Two problems this census surfaces:**

1. **Inter is declared but never loaded.** `frontend/src/index.css:72` sets
   `body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }` but no `@font-face`,
   `@import` or `<link>` for Inter exists anywhere in `frontend/`. Every page today silently
   renders in `system-ui`. All 107 canvases request Inter.
2. **Roboto Mono is loaded the wrong way.** `frontend/src/index.css:1` is
   `@import url("https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@500;600;700&display=swap");`
   — a CSS `@import` is **render-blocking** and serialised behind the stylesheet, the exact thing
   the Space Grotesk block was written to avoid. It also ships axes `500;600;700`, missing the
   `400` that 43 canvases request.

**Recommended replacement** — delete `index.css:1` and add two blocks to `index.html`
alongside the Space Grotesk block (the two `preconnect` lines are already there and are shared):

```html
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'" />
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" /></noscript>

  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&display=swap" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'" />
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&display=swap" /></noscript>
```

(Or fold both families into one `css2?family=Inter:…&family=Roboto+Mono:…` request, which is what
all 54 Roboto-Mono-loading canvases do — one fewer round trip.)

`frontend/public/verify-email.html:8-10` loads Space Grotesk with a **plain blocking**
`<link rel="stylesheet">`; it is a standalone page outside the SPA and was presumably left as-is
deliberately.

---

## 5. Decisions taken while producing this census

1. **Corpus boundary.** 107 top-level `*.dc.html`. `uploads/`, `scraps/`, `assets/` excluded per
   brief; `Axal VC Pitch Deck - standalone.html` and `Axal VC Pitch Deck Slides - standalone.html`
   excluded because they are not `.dc.html` canvases.
2. **Inline styles count.** Most tokens live in `style="…"` attributes, not `<style>` blocks.
   Excluding them would have undercounted colours by roughly 10×.
3. **Canvas count, not occurrence count, is the primary metric** (per brief), with occurrence
   count reported as a tiebreak. They disagree materially in two places: `#615c6e` (42 canvases
   but 1089 occurrences) and label tracking `.07em` vs `.09em` (both 57 canvases; 175 vs 70 occ).
4. **The System Sheet spec overrides raw frequency for the named semantic ramp.** Frequency is
   still recorded for every token in `tokens.json` under `majority` / `otherCompetitors`, so this
   decision is reversible without re-running the census.
5. **`#fff` and `#ffffff` are merged** into one `surface` token; the corpus writes the short form
   1883 times and the long form 47 times.
6. **No token was invented.** Every value in `tokens.json` is a literal read out of at least one
   canvas. Where the spec names a role the corpus barely uses (`positiveTint` `#eefbf5`, 6
   canvases), that low count is recorded rather than the token being silently upgraded.
7. **Spacing was not forced onto a scale.** The corpus has no discrete spacing ramp, so
   `tokens.json` records the 6 spec steps as named tokens and lists the 15 off-scale values that
   outrank them by occurrence, rather than pretending a scale exists.

---

## 6. Open questions for whoever folds this into DECISIONS.md

1. **Hairline `#e8e6ee` vs `#ececf1`.** 21 canvases vs 91 — the single biggest divergence. If the
   platform is not being re-skinned to the spec-family look, `#ececf1` is the pragmatic choice.
2. **Ink `#241f38` vs `#18181b`.** Same question, one level up. Adopting `#241f38` means every
   existing canvas-derived screen shifts warm/violet.
3. **Label tracking.** Recommend shipping both `.11em` (mono) and `.07em` (Inter) rather than
   picking one.
4. **`99px` vs `999px`.** Cosmetic; pick one and normalise.
5. **Artboard width.** 1080px is the spec frame but 1440px has 4× the canvases. If the census is
   feeding a layout container token, this needs an explicit call.
6. **`font-mono` collision.** 233 existing usages in `frontend/src` currently resolve to
   Tailwind's default mono stack. Defining `--font-mono: 'Roboto Mono', ui-monospace, monospace`
   in `@theme` will restyle all 233 at once. Intended, but worth flagging as a visual diff.
