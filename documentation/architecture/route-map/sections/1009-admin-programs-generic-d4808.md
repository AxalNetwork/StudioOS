### Admin › Programs › any program, and a proposal's review (D4808, #4808)

A program the nine do not include (one an approval or New program made) has no route of its own. `frontend/src/routes/adminProgramsGeneric.jsx` registers `/admin/programs/:key`, which draws any key the registry holds (`pages/admin/programs/GenericProgramPage.jsx`), and a proposal's review (`ProposalReviewPage.jsx`). Both are under `guard(['admin'])`, never `hqOnly`. React Router ranks the literal addresses above these, so the nine keep their pages.

| Address | What it draws | Worker routes |
| --- | --- | --- |
| `/admin/programs/:key` | The shell every program shares: About (the registry row), Availability (D956's grant), Declared capabilities (each marked not operational until something enforces it), the Approved proposal exactly as approved, and the operating screen where the frontend knows one for the key | `GET /api/admin/programs/:key` (adds `approved_proposal` and `capabilities`) |
| `/admin/programs/:key/how-it-runs` | Part 1's playbook; a Super Admin edits the draft and publishes it | `PUT …/playbook/sections/:section`, `POST …/playbook/publish` |
| `/admin/programs/:key/activity` | Part 1's activity | `GET /api/admin/programs/:key/activity` |
| `/admin/programs/proposals/:uid` | A proposal's review before Decide: every submitted field, what is not operational, and Decide (a Super Admin's) | `GET /api/admin/programs/proposals/:uid`, `POST …/decision` |

The catalogue draws a card with an Open door for every registry row, refreshes after New program and offers Open program, and shows only a compact proposal line (`Open proposals`); the search, filters and review live at `/admin/programs/proposals`.

**`GET /api/admin/programs/:key`** also returns `approved_proposal: { proposal_uid, decision, decided_at, spec } | null` (the frozen record in `program_approved_specs`, append-only) and `capabilities: [{ key, label, operational }]`. `spec.fields` holds every material proposal field as approved; `spec.not_operational` names eligibility, rewards, contracts, tools and HQ obligations as recorded, not enforced.
