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
| `advisor/` | Eadwyn's chat (`PersonalAdvisor.jsx`) and its panels. Every Studio home mounts it through `StudioInterview.jsx`, which collapses it to the one "interview complete" row in `interviewCompleteRow.jsx` once the server says the interview is complete (D324). Like the chat itself, the wrapper makes its own reads (progress and the proposal queue), so the collapse behaves the same on all five homes. |
| `auth/` | Shared auth chrome (`AuthShell`) for sign-in and onboarding entry. |
| `brand/` | Brand builder; `brand/templates/` holds the landing-page previews. |
| `cofounder/` | Co-founder agreement and matching. |
| `command-center/` | Founder command-centre widgets. |
| `discovery/` | Customer-discovery tooling. |
| `events/` | Event cards and RSVP pieces. |
| `licence/` | Licence-holder pieces. `DomainWizard.jsx` is S17–S19's custom-host wizard: it states its own absence on a branch, because the host register is HQ's and a branch cannot read another tenant's bindings. Registrar chips name where the person publishes the same two records, and Copy all copies one whole record (D449). |
| `officehours/` | What an office-hours session left behind (D355): `SessionFollowups.jsx` draws the action items both parties keep and the founder's rating. It fetches for itself, because the founder's Office Hours page and the partner's `/partner/office-hours` render the same list and must not drift apart. |
| `play/` | Playbook steps. |
| `products/` | Product and catalogue cards. |
| `profile/` | Profile blocks shared across personas. |
| `scoring/` | The scoring engine's panels. |
| `signals/` | Signal cards and evidence drawers. |
| `spinout/` | Spin-Out Lab shared pieces. |

## Top-level shell pieces

- `MobileTabBar.jsx` (D425) — the phone's four tabs and More sheet below
  1024px, founder first, from `../lib/mobileTabs.js`. `mobileTabBar.css` holds its
  safe-area insets and `--mobile-tabbar-h`, which pads the page's content while
  a bar is drawn. The shell (App.jsx) mounts it; it renders nothing for a
  licence with no plan.

## Rules

- Presentational by default. Fetching belongs to the page; a component that
  calls `api.*` is taking ownership it usually should not have.
- Dark mode is required (`check-dark-mode` runs on every build).
- No component invents data to fill a gap. An absent value renders as absent.
