# Portfolio UX audit, 2026-11-09 — evidence

The evidence behind `PORTFOLIO_UX_AUDIT_2026-11-09.md` one folder up (issue
#4816). Like every audit here, it is a snapshot: true on its date, not
maintained afterwards.

| Path | What it holds |
| --- | --- |
| `capture.mjs` | The rerunnable capture: serves a built `docs/`, signs in a synthetic investor, answers every `/api/*` call from the fixtures and writes the screenshots. Not a test; nothing in CI runs it. |
| `fixtures/` | `portfolio.mjs`: the synthetic API answers (invented companies and figures, shaped from the Worker routes on the audit date). |
| `screens/` | One JPEG per screen, state and viewport (`<id>-<desktop\|tablet\|phone>.jpg`), and `metadata.json` with each capture's `document.title`, meta description, canonical, headings, landmarks and, on desktop journeys, the first 25 Tab stops. |

Adding to it: don't. A later audit gets its own dated folder.
