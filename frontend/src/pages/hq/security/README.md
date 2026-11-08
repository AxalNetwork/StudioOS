# pages/hq/security — Security v2 (D4800, #4800 to #4803)

The pieces of HQ › Security v2 at `/admin/security`, from the landed canvas
(`design/incoming/Security v2 Page.dc.html` and `Security v2 · Boards.dc.html`,
boards SE01 to SE12, spec boards SEA to SEE; D4803). `../SecurityPage.jsx` is
the host: it makes the page's three reads once, draws the shell and holds the
`workspaces` map. Each workspace that Security v2 rebuilds gets its own file
here; until then its entry in that map holds today's zones for its area.

| File | What it is |
| --- | --- |
| `securityTabs.js` | The workspace registry: the seven workspaces in canvas order (Overview, Events, Access, Privacy, Trust, AI Safety, Resilience), `tabFromSearch` (an unknown `?tab=` opens Overview), `tabHref`, `tabOf`, and `tabAfterKey` (Left and Right wrap, Home and End). The one list of workspaces. |
| `SecurityTabs.jsx` | The switcher: a `nav` of `?tab=` links with `aria-current="page"` and arrow-key movement on desktop and tablet, a 44 px section select on phone, and a mark on a workspace with open findings (shape, count, and "n items need action" as text). |
| `securityStates.js` | The shared state vocabulary (SE02): thirteen states, each with a word, a shape and a description. `securityState(key)` throws on an unknown key; `readFigure(value, { readable })` returns `unavailable` with no text for anything unread, and `measured_zero` for a real 0; `severityOf` orders findings. |
| `StatusBadge.jsx` | Draws one state: shape, word, and the description as visually hidden text. `label` replaces the word on screen and keeps it for screen readers. `ReadValue` draws a count, or Unavailable with Retry, never 0. `StateShape` is the glyph alone. |
| `overviewModel.js` | `buildOverview({ overview, feed })`, pure: Action required (findings, most severe first, each with evidence and one action; a check that could not run is a finding), Checked and clear (measured zeros that ran, with what was read and when), status by area (eight cells, no score), the source count and the tab marks. Reads only `/overview` and `/governance`. |
| `OverviewWorkspace.jsx` | The Overview workspace in canvas order: `ActionRequiredList`, `CheckedAndClear`, `StatusByArea`, then the evidence sources. |
| `SourceAvailability.jsx` | "n of n sources read" from the ledger's `sources[]`, with a failed source named and Retry beside the count, and the store names and implementation notes behind Source details. |

Tested by `frontend/test/hq_security_v2_d4800.test.mjs`; the zones that stay
in `../SecurityPage.jsx` keep their own tests (`hq_security*.test.mjs`,
`hq_governance_h7.test.mjs`).

## Rules

- **Every status uses the vocabulary.** Draw state with `StatusBadge` and a key from `securityStates.js`; never a colour alone, never a new word. "Not recorded" is retired for new work: say Unavailable, Not instrumented, Unsupported, Measured zero or No data yet.
- **An unread value is never 0.** Use `readFigure` or `ReadValue`. A count of `null` is not a zero, and a failed read is not Healthy.
- **A workspace is a registry entry.** Add or rename a workspace in `securityTabs.js` only; replace its body in `SecurityConsole`'s `workspaces` map (Access is #4801's). Never add a second switch.
- **No figure the Worker does not return.** Where the canvas needs one that no read has, draw Not instrumented or Unavailable and say so in the decision file.
- **No request from these files.** The reads stay in `../SecurityPage.jsx`, so moving between workspaces never re-reads.
- Light and dark: every colour class carries its `dark:` pair.
