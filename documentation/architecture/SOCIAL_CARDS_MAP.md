# SOCIAL_CARDS_MAP.md — which card each page shares as

D1440 (#3915, Part A of #3705). This is one row per route group: who can open it, whether a link to it is meant to be shared, which card it previews as, and where that card's title and image come from. How the cards are built is in `SOCIAL_PREVIEWS.md`. The retirement calls for the routes at the bottom are in `decisions/D1440.md`.

**Sources.**
- **Routes and guards:** `frontend/src/App.jsx` on `main` at `5c2288dbf5`.
- **Card keys:** `frontend/src/lib/ogRegistry.js`.
  - Keys marked **(D1604, pending)** arrive with PR #3913, which is open at the time of writing: `event`, `authors`, `terms`, `privacy`, `privacy-interviews`, `risk-disclosures`, `pricing-investor`, the six `trust*` keys, and `FAMILY_OG_KEYS` = `event`, `profile`, `private`.
  - Until #3913 merges, those routes use their section card.
- **Record cards:** the Worker card injector, Part B (`decisions/D1439.md`, #3914).
- **Token-link card:** Part D, after owner question B on #3705.

**Columns.**
- **Access:** `public` (no sign-in), `signed in` (any role the guard admits), `admin`, or `token` (a bearer link that needs no account).
- **Shareable:** whether a link to it is meant to travel in a message or a post.
- **Card:** the image key, `/og/<key>.png`.
- **Title source and image source:** where the preview's `og:title` and `og:image` come from.
- **Prerendered:** the route has its own `docs/<path>/index.html`, written at build time by `scripts/prerender-og.mjs`. Every other path is served the SPA shell (`docs/index.html`), which carries the **home** card unless the Worker rewrites it.

## 1. Fixed public pages (prerendered, live today)

The title and description are the registry entry's. The image is the entry's `key`, or else its section's key, or else `default`.

| Route | Access | Shareable | Card | Title source | Image source |
| --- | --- | --- | --- | --- | --- |
| `/` | public | yes | `home` | registry | `/og/home.png` |
| `/spinout-lab` (prefix) | public | yes | `spinout-lab` | registry | `/og/spinout-lab.png` |
| `/lp/spinout-demo-day` | public | yes | `spinout-lab` (section) | registry | section card |
| `/for-founders`, `/for-investors`, `/for-service-partners`, `/for-advisors` | public | yes | `product-founders`, `-investors`, `-service-partners`, `-advisors` | registry, mirrored from `data/productPages.js` | own card each |
| `/platform`, `/administrators`, `/intelligence` | public | yes | `product` (section) | registry | section card |
| `/pricing` | public | yes | `pricing` | registry | own card |
| `/pricing/investor` | public | yes | `pricing-investor` (D1604, pending; `company` until then) | registry | own card |
| `/demo`, `/about`, `/team`, `/methodology`, `/contact`, `/newsletter`, `/changelog`, `/status`, `/register`, `/login` | public | yes | `company` (section) | registry | section card |
| `/terms`, `/privacy`, `/privacy/interviews`, `/risk-disclosures` | public | yes | `terms`, `privacy`, `privacy-interviews`, `risk-disclosures` (D1604, pending; `company` until then) | registry | own card |
| `/trust` and its five tabs (`/security`, `/data`, `/subprocessors`, `/documents`, `/disclosure`) | public | yes | `trust`, `trust-security` … `trust-disclosure` (D1604, pending) | registry (D1604 adds the entries) | own card. **Until #3913 merges these routes have no entry and preview as `home`.** |
| `/articles`, `/jobs`, `/events`, `/authors` (the section pages) | public | yes | `articles`, `jobs`, `event` (D1604; `content` until then), `authors` (D1604; `content` until then) | registry | section family card |
| `/circles`, `/directory` (prefix), `/resources` | public | yes | `content` (section) | registry | section card |

## 2. Public records (Part B, D1439)

Each prefix matches **exactly one** segment (two for `/insights/public/`). The Worker reads the record with the page's own public gate and rewrites the shell's tags. A missing record and a private one return the same section card, byte for byte, so a preview never confirms that a record exists.

| Route | Access | Shareable | Card on a hit | Title source | Image source | On a miss or private |
| --- | --- | --- | --- | --- | --- | --- |
| `/events/:slug` | public (published, and admin-published or unlisted) | yes | `event` family (`content` until D1604) | the event's `title`; description from `summary`, start time, timezone, venue kind. Never price, capacity, seats or join link | its `cover_url` when https, else the family card | the `/events` card |
| `/articles/:slug` | public (`status='published'`) | yes | `articles` | the article's `title`; excerpt, read time, author name | its cover (`/api/articles/cover/<id>`) when set, else `articles` | the `/articles` card |
| `/insights/public/:slug` | public (its own published gate) | yes | `articles` | the insight's title | `articles` | the `/articles` card |
| `/jobs/:slug` | public (published and admin-published) | yes | `jobs` | role, venture, location. **Never the pay band** | `jobs` | the `/jobs` card |
| `/authors/:id` | public (the author read's gate) | yes | `authors` (D1604; `content` until then) | the author's display name | `authors` | the `/authors` card |
| `/u/:handle` | public only when the person's effective visibility is Public (D702) | yes | `profile` (D1604; `default` until then) | name and headline only | `profile` | the Axal default card |
| `/startups/:handle` | public (not archived, rejected or intake) | yes | `profile` (D1604; `default` until then) | name, stage, one line of description. No traction, no amounts | `profile` | the Axal default card |
| `/partners/:slug` | public, **only when `DIRECTORY_LISTED_WHERE` holds** (stricter than the page's own `status='active'`) | yes | `profile` (D1604; `default` until then) | name, company, specialisation | `profile` | the Axal default card |

**Reserved paths stay untouched** and keep the shell as served: `/events/new`, `/jobs/new`, `/articles/draft`, `/articles/mine`, `/partners/onboard`, `/partners/portal`, and every path two or more segments deep under these prefixes (`/events/:id/edit`, `/events/:id/manage…`, `/jobs/:id/edit|manage`).

**Not yet carded.** `/advisors/:uid` needs its anonymous gate confirmed before it gets a card; until then it previews as `home`.

## 3. Token links (Part D, after owner question B)

| Route | Access | Shareable | Card | Title source | Image source |
| --- | --- | --- | --- | --- | --- |
| `/esign/:token`, `/deck/share/:token`, `/share/deck/:token`, `/share/captable/:token`, `/share/captable/venture/:token`, `/invite/:token`, `/join/:token` | token | yes, to the named recipient | today `home`; with Part D, `private` ("Axal VC · Sign in to view") and `x-robots-tag: noindex` | fixed text, never the record (no D1 read) | `/og/private.png` (D1604) |
| `/verify/:token` | token (certificate verification) | yes | `home` | registry home entry | `home`. It stays so unless the owner makes it public |

## 4. Signed-in and admin pages

| Route group | Access | Shareable | Card | Title source | Image source |
| --- | --- | --- | --- | --- | --- |
| Workspaces: Founder (`/validate`, `/build`, `/raise`, `/grow` and below), Investor, Advisor, Partner, Explorer, `/account/*`, `/settings*`, `/calendar`, `/studio`, `/round-calls/:uid`, `/raise/capital-relationships/calls/:uid` | signed in | no (a link lands on sign-in for anyone else) | `home` (the SPA shell) | the home entry | `home` |
| `/admin*` and the HQ consoles | admin | no | `home` | the home entry | `home` |

The home card leaks nothing about the page. Owner question B on #3705 decides whether these get the `private` card instead. S1's pick is (a): token links only, since covering every signed-in path would make the Worker run on every page load.

## 5. Founder sites (unchanged, out of scope)

| Route | Access | Shareable | Card | Title source | Image source |
| --- | --- | --- | --- | --- | --- |
| `/landing/:slug`, `/p/:site[/:page]` | public | yes | the founder's own brand (`socialMeta()` in `services/landingTemplates.ts`), with no tags on noindex previews | the founder's brand name | their logo when https; otherwise no image |

## 6. Routes being retired

Decided in `decisions/D1440.md`. Each one previews as `home`, through the shell, until its redirect lands.

| Route | Access | Today | D1440 |
| --- | --- | --- | --- |
| `/compliance` | signed in | redirects to `/calendar?layer=compliance` (D1384, #3692), counted | redirect; retired at the 2027-01-19 review by its count |
| `/account/companies*` (four patterns) | signed in | redirects to `/account/portfolio` (`CompaniesMovedRedirect`, #3697), counted | redirect; retired at the review by its count |
| `/product-testing` | signed in | redirects to `/studio`, counted, `keep: true` | keep the redirect |
| `/lp/founder`, `/lp/customer-discovery`, `/lp/investor`, `/lp/partner` | public | redirect to `/for-*`, counted | keep: external links carry them |
| `/comarketing`, `/comarketing/:pitch` | signed in (admin, partner, founder, investor; the pitch page admin and partner) | a page | S1's split (owner question D, pick (a)) |
| the #2319 redirect list (`redirectRoutes.ts`) | mixed | redirects, counted as `redirect:<pattern>` in `public_pageviews` | decided entry by entry at the 2027-01-19 review; `keep: true` entries stay |
