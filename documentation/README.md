# documentation/

Everything here is **written by a person**. Nothing here is generated, and
nothing here is served.

> **`documentation/` is not `docs/`.**
>
> `docs/` at the repo root is the **built frontend bundle** — the Worker's
> `[assets]` directory. It is written by `npm run build` and must never be
> hand-edited. If you are looking for a document to read or edit, it is in
> here.

## Layout

| Folder | What lives there |
| --- | --- |
| `architecture/` | How the system is actually put together, and the decisions behind it. Start with `architecture/CODEBASE_MAP.md`. |
| `audits/` | Point-in-time findings. Each one is true *as of its date* and is not maintained afterwards. |
| `operations/` | Runbooks — what to do when something is on fire. |
| `product/` | Positioning and feature notes. |

## The four that answer most questions

| Question | File |
| --- | --- |
| Where does anything live? | [architecture/CODEBASE_MAP.md](architecture/CODEBASE_MAP.md) |
| Which canvas maps to which route, and what shipped? | [architecture/ROUTE_MAP.md](architecture/ROUTE_MAP.md) |
| Why is it built this way and not the obvious way? | [architecture/DECISIONS.md](architecture/DECISIONS.md) |
| What will bite me? | [architecture/GOTCHAS.md](architecture/GOTCHAS.md) |

`CLAUDE.md` stays at the repo root and outranks everything here: where a
document disagrees with it, `CLAUDE.md` wins and the document is the thing to
fix.

## Reading an audit

An audit is a **snapshot, not a spec**. `audits/BETA_READINESS_AUDIT_2026-05-20.md`
describes the platform on 20 May 2026 and was correct then. Do not treat a
finding in an audit as a live bug without re-checking it against the code —
several have been fixed since, and the audit files are not updated when they
are. `audits/PLATFORM-DELIVERY-AUDIT.md` is the most recent full sweep.

## Files deliberately left at the repo root

Six, each because a tool or a convention expects to find it there:

- `CLAUDE.md` — read by Claude Code from the root
- `replit.md` — read by Replit from the root
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md` — GitHub surfaces these from the
  root (or `.github/`) and nowhere else
- `CHANGELOG.md` — conventional root location

`frontend/test/repo_layout.test.mjs` fails the build if a seventh appears, so
the root cannot quietly refill with the 38 files this folder was created to
hold.
