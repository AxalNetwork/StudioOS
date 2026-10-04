# Instructions for GitHub Copilot in this repository

Read `CLAUDE.md` at the repository root before anything else. It is the
authority on where production runs and how the repository is laid out: where
any other document disagrees with it, it wins. `documentation/README.md`
indexes everything else.

- **Never commit `docs/`.** It is build output and is gitignored (D529): CI,
  the PR preview and the deploy each build it from `frontend/src`. Run the root
  `npm run build` locally before the full suite, which reads the built SPA.
  Never run a bare `vite build` and never edit `docs/` by hand.
- **Run the full suite and read its exit code**:
  `npm run test:drift > drift.log 2>&1; echo EXIT=$?`. Never pipe it — a pipe
  reports the last command's status, not the suite's — and never grep its
  output for a pass.
- **Never edit a migration that has been applied.** A schema change is a new
  file under `cloudflare-worker/sql/migrations/`.
- **No `/api/*` method in `frontend/src/lib/api.js` without its Worker route**
  in `cloudflare-worker/src/`, in the same commit.
- **No model identifier** in commits, PR titles or bodies, or code.
