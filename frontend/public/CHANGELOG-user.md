# What's new

A plain-English summary of recent changes to StudioOS, written for
everyone using the platform. Newest changes are at the top.

For the detailed engineering log (with task IDs and code references),
see the [technical changelog on GitHub](https://github.com/axalnetwork/StudioOS/blob/main/CHANGELOG.md).

---

## Easier: a one-click jump from the Lab to your Demo Day deck

The Spin-Out Lab dashboard now shows a "Generate your Demo Day deck"
button whenever your pitch deck milestone is still open, and stays
visible all through Week 4 so it's there when you actually need it.
Clicking it drops you straight into the pitch-deck builder with the
new 14-slide Demo Day template already applied — no scrolling through
the template picker. Once your deck exists, the button quietly
relabels to "Open Demo Day deck" so you can come back and refresh it.


## New: a Demo Day pitch deck made for Spin-Out Lab graduates

There's a 13th template in the pitch-deck picker: **Axal 30-day Spin-Out
Lab — Demo Day**. It's a 14-slide deck shaped specifically for founders
graduating the Lab and presenting to Axal-network investors and
partners. The deck reads directly from your Lab data — your discovery
interviews, milestones, OKRs, score, cap table — so the numbers on
screen are the numbers you actually logged. Where something's missing,
the deck shows a small em-dash and a hint pointing you to the page
where you can fill it in. No invented traction.

You can flip between four looks for the same deck — editorial (warm
serif), product-first (dark, bold), data-dense (compact and tabular),
and manifesto (high-contrast, oversized type) — using the switcher in
the top-right of the editor. Your choice sticks for that deck and is
what investors see when you share the link.

Free for everyone on the platform.


## Fixed: stale offline cache kept old broken bundle alive after share-link fix

If you had StudioOS open in your browser before, the offline cache could
keep serving the older app code even after we shipped a fix for the
share-link crashes. We've refreshed that cache version, so next time
the production app is published, your browser will pick up the latest
version automatically.

## Fixed: one-time share links crashing on the cinematic deck templates

One-time share links for the Narrative — Brand-led deck (and other
templates built on the same engine) were hitting an "unexpected error"
page instead of rendering the slides. Share links now load reliably
across every template.

## Fixed: Investor + Appendix and Narrative — Brand-led previews

The picker and preview pane were showing a red "Failed to render" card
instead of the slides for these two templates. Both now render their
full sample decks again.

## May 2026

- The **Narrative — Brand-led** pitch-deck template was rebuilt as a
  15-slide cinematic brand story told in four acts — The World, The
  Belief, The Solution, and The Future. It uses editorial typography
  (Playfair Display headlines on warm cream paper), an ember/gold/sky/
  dusk palette, and custom hand-drawn artwork on every slide, ending
  on a red-ember manifesto. No charts, no stock photos — just story.
- The **Investor + Appendix** pitch-deck template was rebuilt from
  the ground up. It's now a full 42-slide institutional fundraising
  deck — a 12-slide core investor story plus a 30-page appendix
  organised across nine sections (Market, Product, Traction, Customer
  insights, Unit economics, Go-to-market, Defensibility, Team &
  operations, Financials). It's set in a magazine-style editorial
  palette with crimson, navy, and gold accents, hand-drawn diagrams,
  and built-in charts for ARR, retention cohorts, channel mix, and
  three-year financials. There's a footer toggle to jump between the
  core deck and the appendix, and you can press `A` to jump straight
  to the appendix. It autofills from your project data and ships with
  polished sample content so it always renders cleanly and exports
  to PDF.
- **Pitch decks shared via one-time link** now present properly in
  fullscreen — one slide at a time, centred and letterboxed, with
  no peek of the next slide. Use the arrow keys, Space, or PageUp/
  PageDown to navigate, Home/End to jump to the ends, and Esc to
  exit. Press `f` from anywhere to toggle fullscreen.
- **"Save as PDF"** on a shared deck now downloads a real
  1920×1080 landscape PDF directly to your computer — no browser
  print dialog, no page margins or headers, and no extra clicks.
  A small progress indicator shows which slide is being rendered.
- The **Sales — Customer-facing** pitch-deck template was rebuilt
  from the ground up. It's now an 18-slide enterprise sales deck
  designed to close customers, not investors — covering customer
  context, the solution and how it works, quantified business value
  and ROI, three role-specific use cases with hand-drawn product
  screens, a competitive matrix, a realistic deployment plan, an
  integration architecture, an enterprise security & compliance
  page, transparent pricing, and a 90-day path to a signed pilot.
  It autofills from your customer-opportunity data and ships with
  polished sample content so it always renders cleanly and exports
  to PDF.
- The **Partnership / BD** pitch-deck template was rebuilt from the
  ground up. It's now a 12-slide executive-consulting deck in the
  voice of a top-tier strategy firm — executive summary, industry
  context, partner challenges, shared opportunity, solution overview,
  platform architecture, quantified business benefits, an
  18-month implementation roadmap, comparable case studies, a
  revenue-share commercial structure, governance & risk, and a
  90-day path to a signed pilot. Every diagram is hand-drawn (no
  screenshots needed), it autofills from your partnership data, and
  it ships with polished sample content so it always renders cleanly
  and exports to PDF.
- Fixed a preview crash on the new **Demo Day — Product-first** pitch
  deck template — the market slide was throwing on an unknown accent
  colour, which made the picker show "Failed to render demo_day"
  instead of the actual preview. The deck now renders cleanly.
- The **Demo Day — Product-first** pitch-deck template was rebuilt
  from the ground up. It's now 12 product-first slides with a warm
  YC-style orange accent and hand-drawn product mockups baked right
  into the deck — dashboard, before-and-after workflow, split editor,
  kanban board, analytics, and a mobile screen — so you can walk
  investors through how the product actually works without screenshot
  attachments. It autofills from your project data and ships with
  polished sample content so it always renders cleanly and exports
  to PDF.
- The **Series B — Diligence Pack** pitch-deck template was rebuilt
  from the ground up. It's now a full 32-slide board-grade deck (22
  main slides plus a 10-page appendix) covering opportunity, product,
  traction, GTM, defensibility, organization, and the investment ask —
  with appendix pages for financials, cohorts, segmentation, funnel,
  pricing, architecture, security, risks, governance, and a three-year
  operating plan. It autofills from your project data and ships with
  polished sample content so it always renders cleanly, exports to PDF,
  and works in one-time share links.
- The **Minimal Seed** pitch-deck template got a complete visual
  upgrade — six slides, one investor question each, in a clean
  Linear/Stripe-style aesthetic with built-in product mockup, charts,
  expertise radar, and a use-of-funds donut. It still autofills from
  your project data and falls back to polished sample content for
  anything you haven't filled in yet.
- You can now **sign in with Google** in one click — the same Google
  account stays linked to your Axal account across visits.
- When connecting Google Calendar, Google's account picker now always
  shows up so you can pick the right account, and you can't
  accidentally link a Google identity that already belongs to a
  different Axal user.
- The whole app now has a proper **dark mode**. Switch in Settings →
  Appearance (Light, Dark, or Follow system).
- A **help widget** sits at the bottom-right of every page —
  click it any time you need a hand. Power users can also press
  `Cmd/Ctrl + K` to open a search bar that jumps anywhere in the app.
- **Pitch decks shared via a one-time link** now respond to keyboard
  arrows in fullscreen on every browser. Press `f` to go fullscreen,
  arrow keys or space to advance.
- New **in-app chat with the Axal team** for paid-tier members —
  reach a human without leaving the app. Look for the chat button on
  the bottom-right; replies come back to the same thread.
- Founders, investors, partners, and mentors can now **write and
  submit articles** for the public news feed. Drafts auto-save,
  submissions go through a quick review, and you get notified at
  every step.
- **Account recovery** is more robust: if you lose your authenticator
  app, use your saved recovery codes or nominate a trusted contact
  who can vouch for you.
- **Dashboard loads noticeably faster** and several pages that used
  to occasionally show a blank screen after a stale tab now recover
  gracefully.
- We fixed an issue that sometimes signed people out unexpectedly
  when switching tabs.

## April 2026

- New **Personal Advisor** on the dashboard suggests the next thing
  worth doing based on your role and the stage you're at, with a
  link straight to the relevant tool.
- **Market Intelligence** sector signals are easier to filter and
  save to a watchlist.
- The **command palette** (`Cmd/Ctrl + K`) now searches across pages,
  your recent activity, and the documentation.

## March 2026

- **HubSpot** can now be connected with a Private App token, so
  organisations that don't use the public HubSpot marketplace can
  still sync deals.
- Connected accounts now show clearer disconnect / reconnect
  messages so you always know why a sync stopped.

---

If something landed that should be on this list, tell the team in
support and we'll add it.
