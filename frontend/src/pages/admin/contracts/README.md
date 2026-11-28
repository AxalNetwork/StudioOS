# Contracts

<!-- index: none -->

HQ › Contracts: one desk at `/admin/contracts` in both admin shells (D647),
rebuilt as a legal-operations workspace by D4811. Its tabs are Agreements,
Templates, Corporate Governance and Closings, with the Library behind a
disclosure; `ContractsDesk.jsx` draws the desk and `parts.jsx` holds the shared
pieces (the read states, the side panel, the PDF helpers). The Worker routes
it reads are under `cloudflare-worker/src/routes/` and the lifecycle words in
`frontend/src/lib/contractLifecycle.js`.

## Where each part is described

This README lists no files and holds no per-part notes (D6472, #6472). A file
says what it is in its own header comment. What each decision or part built,
and the files it added, is in its decision under
`documentation/architecture/decisions/`: `D647.md`, `D713.md`, `D717.md`,
`D758.md` and `D4563.md` for the first desk, and `D4811.md` with its parts
`D4811-p<k>.md` (and `D5050-p2.md`) for Contracts v2. A new part writes its
decision file and edits nothing here.

## Rules

- No fixture figures belong in product rendering. New reads must expose
  failures and use mounted Worker routes. Template publication requires
  migration 434.
