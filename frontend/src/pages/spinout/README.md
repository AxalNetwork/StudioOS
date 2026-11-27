# `frontend/src/pages/spinout/` — Spin-Out Lab for more than one licence (D4474)

`/spinout-lab` is one path that serves two pages: the founder Lab
(`../SpinoutLabPage.jsx`) to a Founder, an Advisor and an Operating Partner, and
the Fund I sales page (`../SpinoutLabInvestorPage.jsx`) to an Investor. The
`/spinout-lab/*` Lab steps stay as `../SpinoutLab*Page.jsx` beside them.

| File | What it is |
| --- | --- |
| `MultiLicenceSpinoutLab.jsx` | D4474 (#4474, part 3 of #3704): for a member who holds two or more licences, one block per held part, in licence order (`spinoutBlocks`, `../../lib/multiLicencePages.js`): the Lab block, once, for Founder, Advisor or Operating Partner, and the Investor block. With one licence it is today's page. `App.jsx` routes here only for a member's own account; an admin, a preview, an impersonation and an exploring account keep the route's ternary. |

## The rule for adding here

- **`SpinoutLabPage` mounts only inside the Lab block.** It reads
  founder-scoped Lab state on mount, so a member with no Lab licence must never
  mount it. Keep both pages lazy.
- **No licence switcher** and no "active" licence (#3704, rules 1 and 6). A
  block's header is its title; it carries no control.
- A block draws through `../studio/LicenceBlocks.jsx`, so it loads and fails
  on its own, in fixed words.
