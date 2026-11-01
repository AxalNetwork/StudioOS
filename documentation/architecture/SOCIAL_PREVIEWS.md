# Social previews (Open Graph) on axal.vc

How link previews are produced, how to set one for a new page, and how to force
platforms to forget a stale one.

---

## 1. What was broken

Sharing any axal.vc link — the homepage, Spin-Out Lab, a product page — produced
the *same* preview card. Four separate faults stacked up:

| # | Fault | Detail |
|---|---|---|
| 1 | **One shell for every route** | axal.vc is a client-rendered Vite SPA. Workers Static Assets runs with `not_found_handling = "single-page-application"`, so every route with no file of its own was answered with the same `docs/index.html` — one `<title>`, one `og:image`, sitewide. |
| 2 | **The declared image did not exist** | That shell advertised `https://axal.vc/og.png`, and no `og.png` existed anywhere in the repo. `seo.js` separately defaulted to `og-default.png`, also missing. A crawler that 404s on the declared image falls back to scraping an arbitrary raster off the page — which is how an unrelated 1536×1024 asset became the preview for everything. |
| 3 | **Meta updates were client-side only** | `usePageMeta()` set the tags in a `useEffect`. WhatsApp, iMessage, Facebook, LinkedIn and Slack do not execute JavaScript; they read the raw HTTP response, so they never saw any of it. |
| 4 | **Almost nothing used it anyway** | Only 6 of ~280 routes called `usePageMeta`, and none passed an image. The homepage, `/spinout-lab` and `/for-founders` were not among them. |

Nothing was wrong with the page *content*. It was entirely a metadata and
delivery problem.

---

## 2. How it works now

```
frontend/src/lib/ogRegistry.js     route → title / description / card / type   (source of truth)
frontend/src/lib/ogManifest.js     card → content hash                         (GENERATED)
scripts/og-assets/                 vendored Space Grotesk subset + notes
scripts/generate-og-images.mjs     renders 1200×630 cards via headless Chromium
scripts/prerender-og.mjs           bakes per-route <head> into the build
scripts/validate-og-tags.mjs       CI gate over the built output
```

`scripts/build-frontend.mjs` runs the prerender automatically after `vite build`
(it must run *after*, because Vite empties `docs/`).

The important property: **the tags are in the raw HTML**. A crawler fetching
`https://axal.vc/spinout-lab` receives `docs/spinout-lab/index.html`, whose
`<head>` already carries the correct `og:title`, `og:description` and a real,
absolute, correctly-sized `og:image`. No JavaScript required.

`usePageMeta()` still runs client-side, resolving through the same
`ogTagsFor()`, so client-side navigation keeps the tab title correct and cannot
disagree with what the server served.

**The card art (#3705).** Since 2026-11-01 the generator draws the
owner's social-cards canvas (`design/incoming/Share Cards Page.dc.html`): one
light 1200×630 image per URL, a lavender art band left of x 268 and the text
block from x 300, so the mark, the eyebrow and the title survive the centred
square crop WhatsApp and iMessage take. Trust and legal pages use the document
card; `/pricing` shows the plan names (never a price). `FAMILY_OG_KEYS`
(`event`, `profile`, `private`) are drawn for the record and private-link cards
that §6's Worker injector (D1439) serves. The generator measures Chromium's
viewport with a `100vh` probe: on Chromium 1194 the screenshot is full size but
its bottom 87px are unpainted, which the old size comparison missed.

### Fallback hierarchy for `og:image`

Highest priority first:

1. **An explicit image** passed for that page (`usePageMeta({ image })`, or an
   `image` override on the registry entry) — the hook for a curated card or a
   CMS-supplied one.
2. **The page's own generated card** — `entry.key` → `/og/<key>.png`.
3. **The section's card** — `/og/company.png`, `/og/content.png`,
   `/og/product.png`. This is why an article looks like an article rather than
   like the homepage.
4. **The sitewide brand card** — `/og/default.png`. Genuinely last resort;
   `validate-og-tags.mjs` warns when more than one route lands here, and fails
   outright if *every* route resolves to one image.

### Cache-busting

`ogImageUrl()` appends `?v=<contentHash>` from the generated manifest. Change a
card's copy → regenerate → its bytes change → its hash changes → its URL
changes, so CDNs and clients keyed on the old URL fetch the new image. Nothing
to remember to bump by hand.

---

## 3. Adding a page

**Ordinary case — nothing to draw.** Add an entry to `OG_ROUTES` in
`frontend/src/lib/ogRegistry.js`:

```js
{
  path: '/new-thing',
  title: 'New Thing',
  description: 'One or two accurate sentences about the page.',
  key: 'new-thing',        // omit to inherit the section card
  type: 'website',
  section: 'company',      // home | spinout-lab | product | content | company
  // prefix: true,         // also match /new-thing/<anything>
},
```

Then:

```bash
node scripts/generate-og-images.mjs     # renders /og/new-thing.png, updates the manifest
node scripts/prerender-og.mjs           # writes docs/new-thing/index.html
node scripts/validate-og-tags.mjs       # confirms it
```

Commit the generated PNG and the manifest. The prerendered HTML is build output:
`docs/` is not committed (D529), and every job that ships it builds it from
`frontend/src`.

**Custom artwork instead of a generated card.** Drop a 1200×630 PNG in
`frontend/public/og/` and reference it:

```js
{ path: '/campaign', title: '…', description: '…', image: '/og/campaign-custom.png', section: 'company' }
```

Anything passed as `image` wins over every generated card (level 1 above).

**Per-page override from a component:**

```js
usePageMeta({ title: post.title, description: post.excerpt, image: post.ogImage });
```

Note this only affects what humans see in the tab — see the gap below.

---

## 4. Forcing platforms to re-scrape

The fix applies to **newly shared** links immediately. Links already shared keep
showing the old card until the platform re-scrapes, because previews are cached
per URL, server-side, for a long time. Force it:

| Platform | How |
|---|---|
| **Facebook + WhatsApp** | [Sharing Debugger](https://developers.facebook.com/tools/debug/) → paste the URL → **Scrape Again**. WhatsApp uses Facebook's cache, so this fixes both. This is the one that matters for the reported problem. |
| **LinkedIn** | [Post Inspector](https://www.linkedin.com/post-inspector/) → paste the URL → it re-scrapes on load. |
| **X / Twitter** | The Card Validator no longer force-refreshes. X re-fetches on its own schedule; a `?v=` query param on the *page* URL produces a fresh card immediately if you need one now. |
| **Slack** | Post the link, then `/remove-link-preview` and re-post, or append `?x=1`. Slack caches ~30 min. |
| **iMessage** | Cached on-device. Deleting the message thread or waiting is the only reliable route — there is no server-side purge. |

Do the Facebook one for the handful of links that circulate most; the rest ages
out on its own.

---

## 5. Verifying

```bash
# what a crawler actually receives
curl -sA "WhatsApp/2.23" https://axal.vc/spinout-lab | grep -E 'og:|twitter:'

# the image resolves, is a PNG, and is 1200x630
curl -sI https://axal.vc/og/spinout-lab.png | head -3
```

The tags must appear in `curl` output, not merely in DevTools — DevTools shows
the DOM after JavaScript has run, which is exactly the distinction that hid this
bug in the first place.

---

## 6. Per-item cards on dynamic routes: closed by D1439

**Closed** (D1439, #3914): the Worker card injector (`cloudflare-worker/src/services/socialCards.ts`)
now answers `/events/*`, `/articles/*`, `/jobs/*`, `/u/*`, `/startups/*`,
`/partners/*`, `/authors/*` and `/insights/public/*` with the record's own
title, description and image, behind each page's own public gate. A missing or
private record gets its section card. Token share links (`/esign/*`,
`/deck/share/*`, `/share/*`, `/invite/*`, `/join/*`) get the static "Sign in to
view" card with `noindex` and no D1 call (D1439 Part D, #3916); `/verify/*` keeps
the home card. The record of the gap follows.

Prerendering covers the fixed public routes. It cannot cover one HTML file per
*item* on content routes — `/articles/<slug>`, `/jobs/<slug>`, `/events/<slug>`,
`/authors/<id>` — because those are database-driven and unknown at build time.

Today those URLs fall through to the SPA shell and therefore preview with the
**home** card and title. That is a correct-looking, on-brand card, but it is not
specific to the article being shared.

Closing it needs server-side injection rather than prerendering: add the content
prefixes to `run_worker_first` in `wrangler.toml`, then have the worker fetch
the shell from the `ASSETS` binding, look the item up in D1, and rewrite the
`<head>` with `HTMLRewriter` before responding (falling back to the untouched
asset on any error). The worker already serves `/p/*` and `/landing/*` this way,
so the pattern exists. That change alters production request routing for those
paths and deserves its own PR.

**Being closed by D1439** (#3914, Part B of #3705): the Worker card injector
does exactly this for `/events/*`, `/articles/*`, `/jobs/*`, `/u/*`,
`/startups/*`, `/partners/*`, `/authors/*` and `/insights/public/*`. Which card
each route group shows, and the token-link card that follows it (Part D), is in
`SOCIAL_CARDS_MAP.md` (D1440).
