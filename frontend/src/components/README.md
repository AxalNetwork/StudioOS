# frontend/src/components — shared presentational pieces

Components used by more than one page, grouped by the feature that owns them.
A component used by exactly one page usually belongs inside that page file
until a second caller appears.

For generic primitives (`Card`, `Pill`, `Stat`) go to `frontend/src/ui/`
instead — this folder is for feature-shaped pieces, that one is for the
building blocks.

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | Advisor-facing panels. |
| `auth/` | Shared auth chrome (`AuthShell`) for sign-in and onboarding entry. |
| `brand/` | Brand builder; `brand/templates/` holds the landing-page previews. |
| `cofounder/` | Co-founder agreement and matching. |
| `command-center/` | Founder command-centre widgets. |
| `discovery/` | Customer-discovery tooling. |
| `events/` | Event cards and RSVP pieces. |
| `play/` | Playbook steps. |
| `products/` | Product and catalogue cards. |
| `profile/` | Profile blocks shared across personas. |
| `scoring/` | The scoring engine's panels. |
| `signals/` | Signal cards and evidence drawers. |
| `spinout/` | Spin-Out Lab shared pieces. |

## Rules

- Presentational by default. Fetching belongs to the page; a component that
  calls `api.*` is taking ownership it usually should not have.
- Dark mode is required (`check-dark-mode` runs on every build).
- No component invents data to fill a gap. An absent value renders as absent.
