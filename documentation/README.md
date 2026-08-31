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
| `operations/` | Runbooks. [`DEPLOY.md`](operations/DEPLOY.md) to ship production; [`INCIDENT_RESPONSE.md`](operations/INCIDENT_RESPONSE.md) when something is on fire. |
| `product/` | Positioning and feature notes. |

## The five that answer most questions

| Question | File |
| --- | --- |
| Where does anything live? | [architecture/CODEBASE_MAP.md](architecture/CODEBASE_MAP.md) |
| Which canvas maps to which route, and what shipped? | [architecture/ROUTE_MAP.md](architecture/ROUTE_MAP.md) |
| Who sees a surface, where in their nav, and how do they reach it? | [architecture/PROFILE_ROUTING.md](architecture/PROFILE_ROUTING.md) |
| What can each role actually navigate to? | [architecture/PAGE_INVENTORY.md](architecture/PAGE_INVENTORY.md) |
| What is blocked, and on what? | [architecture/UNRESOLVED_ITEMS.md](architecture/UNRESOLVED_ITEMS.md) |
| Why was this routed that way with nobody asked? | [architecture/ASSUMPTIONS_LOG.md](architecture/ASSUMPTIONS_LOG.md) |
| Who serves the frontend, and is that changing? | [architecture/CLOUDFLARE-PAGES-MIGRATION.md](architecture/CLOUDFLARE-PAGES-MIGRATION.md) |
| Why is it built this way and not the obvious way? | [architecture/DECISIONS.md](architecture/DECISIONS.md) |
| What will bite me? | [architecture/GOTCHAS.md](architecture/GOTCHAS.md) |
| How do I deploy to production? | [operations/DEPLOY.md](operations/DEPLOY.md) |

## Every folder also explains itself

Beyond this tree, each significant source folder carries its own `README.md`
saying what lives there and the rule for adding to it — `frontend/src/pages/`,
`cloudflare-worker/src/routes/`, `scripts/`, and 30-odd more.
`scripts/check-folder-docs.mjs` fails the build if one is missing, if it does
not name its own subfolders, or if it cites a file that does not exist. So the
fastest way to understand any part of this repo is to open the README of the
folder you are already in.

`design/incoming/README.md` is the one to read before integrating a new Claude
Design export.

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
