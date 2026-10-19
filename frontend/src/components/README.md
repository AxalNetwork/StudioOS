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
| `advisor/` | Eadwyn's chat (`PersonalAdvisor.jsx`) and its panels. Every Studio home mounts it through `StudioInterview.jsx`, which collapses it to the one "interview complete" row in `interviewCompleteRow.jsx` once the server says the interview is complete (D324). Like the chat itself, the wrapper makes its own reads (progress and the proposal queue), so the collapse behaves the same on all five homes. `eadwynPhone.jsx` (D701) holds the chat's phone pieces in a module a Node test can import: `useIsDesktop` (one breakpoint at 1024px), `threadLabel`, `PhoneFocus`, `PhoneBuckets` and `PhoneTicketCard`. On a founder's phone Studio `PersonalAdvisor` draws a `phone` frame, and `EadwynPanels.jsx` and `AdvisorProgressWidget.jsx` take `variant="phone"`. |
| `tickets/` | What a support ticket shows outside its own page. `BountyBadge.jsx` words a ticket's bounty state (D542) once, for the rows of Help → Tickets and for `MyBugReports.jsx`, the list of the member's own bug reports under the chat's ticket form. |
| `auth/` | Shared auth chrome (`AuthShell`) for sign-in and onboarding entry. |
| `brand/` | Brand builder; `brand/templates/` holds the landing-page previews. |
| `cofounder/` | Co-founder agreement and matching. |
| `command-center/` | Founder command-centre widgets. |
| `discovery/` | Customer-discovery tooling. |
| `hqReview/` | HQ review pieces from the Ops canvas (D634): a review comment with Delete beside Resolve, and an identity field masked until Show, whose showing the Worker logs. Their words live in `hqReviewCopy.js`. |
| `deals/` | The deal room's screens from the Ops canvas (D630): joining and leaving with the quota, the Invitations, Transfers and References tabs, and a syndicate's close drawer. `/deals` and `/deals/:dealId` both mount them, and their words live in `dealRoomCopy.js`. |
| `events/` | Event cards and RSVP pieces. |
| `licence/` | Licence-holder pieces. `DomainWizard.jsx` is S17–S19's custom-host wizard: it states its own absence on a branch, because the host register is HQ's and a branch cannot read another tenant's bindings. Registrar chips name where the person publishes the same two records, and Copy all copies one whole record (D449). |
| `officehours/` | What an office-hours session left behind (D355): `SessionFollowups.jsx` draws the action items both parties keep and the founder's rating. It fetches for itself, because the founder's Office Hours page and the partner's `/partner/office-hours` render the same list and must not drift apart. |
| `play/` | Playbook steps. |
| `products/` | Product and catalogue cards; `TokenPacksSection.jsx` reads the public pack list, links each pack to its isolated checkout, and keeps pack prices out of the ordinary cart. |
| `profile/` | Profile blocks shared across personas. |
| `scoring/` | The scoring engine's panels. |
| `spinout/` | Spin-Out Lab shared pieces. |
| `site/` | The public site's stylesheet (`site.css`, D674): the tokens and classes of the owner's website canvas, scoped to `.ax-site` on pages and `.ax-site-chrome` on `PublicNav` and `PublicFooter`. Its links live in `frontend/src/lib/siteLinks.js`. |

## Top-level shell pieces

- `MercuryMatch.jsx` (D713) — "Match to my Mercury" for one of a member's own
  invoices, payouts or settlements. It reads the member's bank only when they
  press it, and confirms or withdraws a match through
  `/api/mercury/personal/matches`. `NeedsBoardPage.jsx`'s invoice and the
  partner's Earnings page both mount it; nothing in it moves money. D752
  (#1989) adds the founder's `raise` and `commitment` targets: the deal
  room's Commitments tab mounts it for the deal's founder.
- `RaiseReceiptMatches.jsx` (D752, #1989) — "Investor wires" on Raise ›
  Capital relationships, for a founder only: one `/matches?target=raise` read
  on press, each committed prospect drawn with `MercuryMatchView`.
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
