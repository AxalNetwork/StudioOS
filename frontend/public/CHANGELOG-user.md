# What's new

A plain-English summary of recent changes to StudioOS, written for
everyone using the platform. Newest changes are at the top.

---

## Expand the Personal Advisor to fullscreen

The Personal Advisor's expand button now opens it in a full-screen view that fills the whole window, giving you more room to chat and to see your progress alongside the conversation. Return to the normal dashboard view any time with the "Back to dashboard" or "Normal view" buttons, or just press Escape. If you leave it expanded, it stays that way the next time you open it.

---

## See exactly where each of your articles stands

Your articles list is now grouped into **Drafts**, **In review**, and **Published**, with a count on each section you can collapse. Every article shows a colour-coded status, its word count, and when you last touched it — so a draft, an article waiting on review, and a live one are instantly distinguishable. Published articles get a one-click "Copy link" and "View live". Inside the editor, a status bar tells you the current stage and whether your work is saved ("Saving…", "Unsaved changes", or "Saved 4s ago"), shows the reviewer's note when changes are requested, and the main button always reads the right next step for you (Submit, Resubmit, Retract, or View live).

---

## Admin pages are working again

Admin tools and pages that were loading empty or showing "Request failed" are back to normal. An extra production sign-in layer had been unintentionally blocking the admin area; it has been removed. Your in-app admin permissions still protect those pages exactly as before.

---

## Cover images for your articles now work

When you add a cover image to an article, you'll now see it right away: a preview appears the moment you pick a file, the button shows "Uploading…" while it saves, and the saved image stays put after a refresh — both while you're drafting and once the article is published. If an upload can't go through (the file is too big or the wrong type), you'll get a clear message explaining why instead of a vague error.

---

## Security: tighter production-only perimeter on sensitive documents

In production, any sensitive document download (signed eSign PDFs, KYC identification files) now requires an additional layer of identity verification via Cloudflare Access before your in-app credentials are even checked. Development and preview environments remain unaffected so you can keep working normally.

---

## New: Preview signed documents and forward them to your legal partners

When you open any signed contract in the Legal → Signed tab, you'll now see a full-screen preview of the PDF with its metadata on the side. You can click "Forward" to send the signed document directly to one or more legal partners by email, with an optional note. You can also choose whether to include the audit page (the signature and timestamp page) or leave it out. Every forward is logged, so you always know who received what and when.

---

## New: Your incorporation signing packet is now assembled automatically

After your incorporation payment is confirmed, we build a complete 8-page signing packet behind the scenes: your jurisdiction-specific Certificate of Formation, the required IRS forms (SS-4 with instructions, Tax Information Authorization, Faxed EIN statement, and Confirmation of Information), a KYC identification page, and a tamper-evident audit trail. Each packet includes a unique hash so you can verify nothing has been altered after assembly. The signing link is emailed to you once the packet is ready.

---

## New: Paid incorporation checkout with per-jurisdiction pricing

The Incorporate wizard now collects payment before we generate your signing packet. When you finish the jurisdiction questionnaire and name check, you'll click "Continue to payment" and be taken to a secure Stripe checkout. After payment confirms, you'll land on a success page that tells you your signing link will be emailed once the packet is ready. You can also check the status of any incorporation from the success page.

---

## New: We check if your company name is available

When you set up a new company in the Incorporate flow, we now check your chosen name against the official business register for that country as you type. You'll see right away whether the name looks available, appears to be taken (with a few of the closest matches), or couldn't be checked automatically. If a name comes back as taken but you know it's fine, you can tick a box to use it anyway. When we can't reach a register, we'll simply ask you to double-check on the official site before filing — nothing ever blocks you from moving forward by mistake.

---

## New: Preview and download incorporation forms

The "Forms" section under Admin → Legal is now live. It includes a set of common IRS-style forms — the SS-4 (with its instructions page), Form 8821, the Statement & Acknowledgement of a Faxed EIN, and a Confirmation of Information. Each one opens in a preview window where you can flip between a version filled with sample details and a completely blank copy, and download either as a PDF. These forms will be filled in automatically with real founder details as the incorporation flow comes together.

---

## New: Edit legal templates right in the app

Admins can now manage the legal template library directly from Admin → Legal → Templates. Templates are grouped by area (internal/GP, fund, portfolio, and compliance), and each one opens a side-by-side editor: type in plain Markdown on the left and see a live, formatted preview on the right. You can create new templates, edit existing ones, and remove ones you no longer need. Every edit is saved as a new version, so there's a full history you can look back on and restore from. Merge fields (the `{{placeholders}}` that get filled in per recipient) are detected automatically as you type, and the "uses" badge still shows where each template has been sent.

---

## Updated: "Contracts" is now "Legal"

The admin Contracts area has been renamed to "Legal" as it grows into a home for incorporation paperwork. Two new sections — "Forms" and "Incorporation" — now appear there; they're empty for now and will fill in over the coming updates. Everything you used before — sent, signed, and voided contracts, NDAs, partner deals, and templates — is exactly where it was.

---

## Updated: "Sign in with a passkey" is back

You can once again sign in with a passkey — Face ID, Touch ID, or a security key — right from the login page. The button appears automatically on browsers that support passkeys. The "Email me a sign-in link" option stays off for now.

---

## Updated: Simpler sign-in, and account recovery works again

- **A cleaner sign-in screen** — signing in now uses your email and your authenticator code (or Continue with Google). The "Email me a sign-in link" and "Sign in with a passkey" buttons have been removed from the login page to keep things simple.
- **Account recovery is fixed** — the "Recover your account" page was showing a "CSRF token missing or invalid" error when you clicked "See my options." That's resolved, so all recovery options — backup code, SMS, email link, trusted contacts, and admin review — now work end to end.

---

## Fixed: Blank page that wouldn't go away after an update

If you ever opened the site and got a blank page that stayed blank even after refreshing — but worked in a private/incognito window — that was your browser holding on to an old cached version of the app. The app now automatically detects when a new version has been published and refreshes itself to pick it up, so you stay on the latest version instead of getting stuck on a blank screen.

---

## Fixed: Dark blank screen and broken pages on load

- **No more dark flash on load** — if your theme is set to light, the page now opens light from the very first frame instead of briefly flashing dark navy.
- **App crashes now show a recovery screen** — if the app fails to start (e.g. a temporary internal error), you now see a clear "Reload page" button instead of a blank dark screen with no way out.
- **Broken-chunk recovery works on all browsers** — if the app fails to load after a deployment (especially on Safari/iOS), the "Reload" button and automatic recovery now work correctly on every browser, not just Chrome.

---

## Fixed: Stripe revenue now flows into your financials

If you connect Stripe, your live MRR, ARR, paying-customer count, and churn now land in your project's financial model automatically — including on the regular background sync — instead of stopping short. Connect Stripe from the Integrations page and your numbers will keep themselves up to date.

---

## Improved: Admin observability and reliability

For admins and operators:
- **Dead-letter queue (DLQ) management** — the Infrastructure panel now includes a dedicated DLQ tab where you can view failed jobs, retry them individually, or permanently discard them. You can filter by source (Cloudflare Queue or D1) to tell where each failure came from.
- **Cron run history** — a new Cron History tab shows every scheduled run, when it started and finished, whether it succeeded, and a summary of what happened. It also displays the schedule for each trigger and when the next run is due, so you can anticipate upcoming background work.
- **WebSocket health check** — the same Cron History panel includes a live spot-check that performs real upgrade handshakes on the pipeline and chat endpoints, so you can verify the full connection chain is working.

(Behind the scenes, Cloudflare Workers trace collection is now enabled for deeper debugging when needed.)

---

## New: Public pages for Spin-Out Lab, About, Insights & the Directory

Key parts of Axal are now public — no sign-in needed.
- **Spin-Out Lab**, the **Directory**, a new **About** page (meet the team), and a new **Insights** page (market briefs and venture intelligence) all open directly from a shared link.
- The top navigation and footer now link straight to About and Insights.
- We tidied the homepage wording so it better reflects the whole network.

---

## New: Easier, safer ways to sign in

Signing in to Axal is now more flexible — and sensitive actions stay protected.
- **Passkeys** — sign in with Face ID, Touch ID, Windows Hello, or a security key, with no code to type. Add and manage your passkeys under Settings → Security.
- **Email sign-in link** — no authenticator handy? We'll email you a one-time link that's good for 15 minutes.
- **Extra check for sensitive actions** — when you sign in with an email link, things like billing and account changes will ask for your authenticator code first, so your account stays secure.
- **Sign out everywhere** — one click signs you out of every device at once.

---

## Improved: A better way to read articles

Articles now open in a polished, magazine-style reading experience.
- A bigger, clearer headline, subtitle, and author details up top.
- A comfortable, narrow reading column with larger, easier-to-read text.
- A table of contents that follows along as you scroll (on wide screens) or tucks into a tidy "Contents" drop-down on phones and tablets.
- A slim progress bar at the top shows how far through the piece you are.
- Share buttons right where you need them, plus a cleaner "Recommended reading" section at the end.

---

## New: Brand kit in pitch decks

Your saved Brand Builder colours and logo now flow into every pitch deck automatically.
- Fundraising decks pick up your accent colour.
- Commercial decks (Narrative, Partnership, Sales, One-Pager) apply your full palette.
- Even if you haven't set a brand kit, your logo still appears on the cover slide.

---

## New: Landing page templates

Your landing page now has five layout options:
- **Minimal** — the clean, centred look you already know.
- **Bold Hero** — a striking, high-contrast headline that grabs attention instantly.
- **Video First** — put a hero image or video front and centre.
- **Editorial** — a long-form, narrative style for storytelling.
- **Product Mock** — show your product screenshot right on the page.

Pick a template in the Brand Builder, and the page auto-rebuilds with the same brand kit, colours, and audience tabs you have already set. Video-first and product-mock templates ask for an image URL so you can point to any hosted image or video.

## New: Audience-segmented waitlist + private preview URL

Your landing page now speaks to three audiences:
- **Customer discovery** — a dedicated tab for people interested in your product.
- **Partner** — for potential partners, distributors, or collaborators.
- **Investor** — for investors scouting your deal.

Each tab has its own headline, body, and CTA, so you can tailor the message. If you leave them blank, the page falls back to your main headline and subheadline so nothing breaks.

Waitlist signups now carry an audience tag, and your founder dashboard shows a filter so you can see exactly who signed up for what.

You can also save a draft without publishing, copy a **private preview URL**, and share it with advisors or teammates for feedback before going live. The preview URL is marked *noindex* so it won't appear in search engines.

## New: Brand Builder expansion — upload logo, AI palette, and tagline ideas

The Brand Builder now has three powerful upgrades:
- **Upload your own logo** — drop a PNG, JPG, or SVG file straight onto the page.
- **AI colour palette** — one click generates a curated 5-colour scheme for your brand, with a warning if contrast doesn't meet accessibility standards.
- **Tagline iterator** — enter your audience, tone, and market angle, and get 6 different tagline suggestions to pick from.

---

## Updated: About page text and LinkedIn link

The About page now includes the latest story copy and the team photo is linked
directly to Guillaume Lauzier's LinkedIn profile.

---

## Updated: Contact form now has spam protection

The Contact form includes a quick "I'm not a robot" check before sending, so
real messages reach us without the spam. We've also removed the separate
"email us directly" link — just use the form and we'll get back to you.

---

## Fixed: Articles now read like a real publication

Article pages are properly formatted again — real headings, paragraphs, lists and
quotes instead of stray symbols and run-on text. Each article also shows the site
header and footer, social share buttons (X, LinkedIn, Facebook, email), the
author's name (linked to their site when available), and a "Recommended reading"
strip with related articles at the end.

---

## Updated: Our Team page is now an About page

The "Team" link in the footer is now called "About". The page keeps the photo
and introduces Axal VC's Managing Partner, with a short note on why Axal exists
and how it helps founders turn ideas into businesses.

---

## Improved: Brand Builder now creates real AI names, taglines and logos

The Brand & Landing Page builder now uses our own built-in AI to suggest brand
names, taglines, and logos — no setup or API key needed. Generate five brand
directions from a short description of your idea, then pick one and we'll craft a
matching logo automatically. If the AI is ever unavailable, you'll still get
solid starter options so the wizard always works.

---

## New: Articles read like a real magazine — and anyone can write one

Article pages now have the full site header and footer, so you can browse the
rest of the platform without losing your place. Every article shows its author's
name, linked to their website where we have one, plus buttons to share the piece
on X, LinkedIn, Facebook, or by email. At the bottom you'll find a "Recommended
reading" strip with more articles to explore — from the same topic where we can,
otherwise the latest. And writing is now open to everyone: just sign in and use
"Write an Article" in the sidebar to draft and submit your own. Your drafts still
get a quick automated privacy check before they go live.

---

## New: Your Spin-Out deck now matches your brand

Your Brand Builder kit now holds a full look — a background colour, an accent
colour, a text colour, and a font pairing — not just a single accent. Your
Spin-Out Demo Day deck picks this up automatically and styles itself as your
"My brand kit" theme the moment you have a kit. Prefer a different look? You can
still switch to one of four ready-made presets, and if a colour choice would be
hard to read the deck quietly falls back to its clean editorial style. Set it
all up in the Brand Builder under Tune.

## Improved: Articles sector filter is now a single dropdown, with more sectors

On the Articles page, the long row of sector chips is now a single, tidy
"All sectors" dropdown that sits right next to the authors dropdown and works
the same on phone and desktop. We also added a few sectors you can filter by:
Robotics, Cybersecurity, Defense, and Bio.


---

## Improved: Cover slide's 30-day activity strip is automatic; one combined People slide

On the Spin-Out Demo Day deck, the "Last 30 days · Lab activity" strip on
the Cover slide is now filled in automatically from your Lab activity — you
no longer edit it by hand. Each day's bar is split by source, with its own
colour and a small legend: milestones, interviews, and advisor answers.
Quiet days still show as faint dots, and exported PDF and PowerPoint decks
match what you see on screen.

Your Spin-Out Demo Day deck now shows your team and your mentor network on a
single People slide instead of two. It leads with profile cards for your
founders, operating partners, advisors, and mentors — each showing their name,
role, and company — and still includes your readiness bars, skill-coverage
chart, mentor sessions, and operating partners, all in one place.

You can now add a company or affiliation to each person: founders set theirs
when editing their project, and the team can set them for everyone on the
network roster. These show up on the People slide automatically. We also fixed
an issue that could stop the deck from loading.


## Improved: "Join & open the deal" now lives on the Review the deal slide

When you view a shared Spin-Out deck, the option to join and open the deal
now appears right on the "Review the deal." slide instead of on a separate
page after the deck. The button still opens the same join and NDA flow,
shown full-size and centered. Other decks are unchanged, and the button is
left out of PDF exports.


## New: Guillaume Lauzier added to the Team page

Guillaume Lauzier, Founding Managing Partner, now appears on the Team
page with his photo. Clicking his photo opens his LinkedIn profile.


## New: Articles by Guillaume Lauzier are live, and the Articles section now loads

Three new articles are published in the Articles section: "How AI is
changing startup investment and venture support," "Why I avoid consensus
and invest early," and "Cybersecurity and zero-trust systems." Each is
categorized so you can filter by topic. We also fixed an issue that
prevented the Articles list and reader from loading at all.


## Fix: Telegram admin page no longer flickers

The Drafts, Compose, and History tabs on the Telegram page kept
flickering as the content reloaded over and over. That's fixed — the
tabs now load once and stay steady while you work.


## New: Spin-Out Demo Day deck now shows a real revenue proof on the Validation slide

The Validation slide used to display a decorative quote-bubble graphic.
It now shows a premium "Revenue proof" card driven by your project's
actual numbers — total revenue, MRR, paying customers, first payment
date, and a status pill (Paid customers / Paid pilot / Pilot signed /
Pre-revenue).

You can fill these in from the project page: open Edit Project and use
the new Revenue section. Before any paying revenue exists, the card
shows a graceful "Pre-revenue" state with your earliest milestone
instead of fake metrics — so the slide always looks intentional.

## Fixed: Pitch Deck template picker now reliably shows every template

The "Pick a deck template" window was sometimes opening empty — "0
methods, no templates registered" — even though all 13 templates
were there. This was a stale browser cache holding onto an older app
bundle from before we fixed a related issue, not a missing template.

The new release refreshes that cache the next time you open the app,
hardens the picker so a partial load can't silently render as zero,
and the header now reads the true number of templates (e.g. "13
templates, auto-filled…") instead of a frozen "12 templates" line.
If the picker ever does fail to load in the future, it now tells you
the actual reason and shows a Retry button instead of a generic
"check the source file" message.

---

## Data room — set the link once on your project, the Demo Day deck reuses it

Your project page has a new "Data room" section. Paste in the URL
to your investor data room (Notion, Dropbox Paper, Drive folder —
whatever you use) and tick "NDA required" if investors need to sign
one first. Save once, and the "Review the deal" button on your
Spin-Out Demo Day deck automatically links there with the right NDA
badge.

If you edit the link directly on the deck slide instead, your change
flows back to the project so the next version of the deck still
pre-fills — no more re-typing your data-room URL every time you
generate a fresh deck.

---

## Mentors & Partners — curate the network that shows up on your Demo Day deck

Axal admins can now manage the mentor and partner network directly,
and the Spin-Out Demo Day deck's "Mentors & Network" slide reflects
that real roster instead of fragments pulled from your advisor
answers.

Each profile carries a name, role, a short bio, a LinkedIn link, an
optional square photo, and a set of skill tags chosen from a fixed
12-axis catalog (Legal, Finance, GTM, Sales, Marketing, Product,
Engineering, Design, Recruiting, Technical DD, Operations,
Fundraising). The deck's skill radar and constellation tiles are
generated from those tags, so the picture stays consistent across
every founder's deck. Profiles can be reordered, temporarily hidden,
or fully removed at any time, and changes show up on the next deck
render.

If you're an admin, you'll find the new editor under Admin →
Mentor & partner network.

---

## Customer Discovery — rate how well your solution fits each interview

You can now record a 0–5 "fit" rating on every Customer Discovery
interview: how well your current solution addresses the problem the
person you spoke with is actually experiencing. Click a pip, optionally
jot a one-line note about what they said, and save.

The rating shows as a small dot row on the interview card so you can
scan your interview log at a glance. Leaving it blank is fine — the
"unrated" state shows hollow outlines and is visually distinct from a
real "0" answer, so we never invent a low score.

Once at least one interview has a rating, the Demo Day deck's
Validation slide automatically lights up its 0–5 histogram the next
time you hit "Fill from project".

---

## Spin-Out Demo Day deck — sharper, 13 slides, and a "Review the deal" call-to-action

The Demo Day deck has had a refresh. Highlights:

- **Branded as Axal VC** on the cover, so it matches the rest of the
  brand.
- **A 30-day activity strip** on the cover shows the rhythm of your
  Lab work at a glance.
- **Pain themes are now charted** on the Problem slide as a frequency
  bar, alongside the raw quotes from interviews.
- **Validation now shows a 0–5 rating histogram** for the validation
  question we asked across your Discovery interviews — plus a badge
  for any revenue proof or signed LOI.
- **Team and Venture Readiness are now one slide** — your founders
  and your readiness score side-by-side, instead of two separate
  pages.
- **Mentors & network now shows mentor profile cards and a skills
  radar** so investors can see who's around the table and what
  ground they cover.
- **New "Product demo" slide** with room for a 30-second loop or a
  screenshot.
- **The "Contact" slide is now "Review the deal"** with a clear
  call-to-action button that links to your deal room, plus NDA and
  data-room status badges.
- **The Axal Signal slide has been retired** — the milestones now
  feed into "Review the deal" instead, so the story ends on the
  ask.

If you've already saved a deck, your previous content carries over —
the new sections just light up as you add the underlying data.

---

## Length guidance for Problem and Solution — no more wall-of-text slides

When you edit a project's Problem Statement or Solution, you'll see a
slim progress bar under each box with a live word count and a short
hint — "Too short", "Good length", "Getting long", or "Too long" —
shaped around the lengths that actually fit on a pitch slide. Problem
sits best between 35 and 60 words; Solution between 35 and 50. You can
still save whatever you want — the bar is guidance, not a wall.

The Axal Spin-Out demo-day deck now uses the same rule: if your
Problem or Solution copy runs past the slide-friendly limit, the slide
trims it to fit (with an ellipsis) and shows a small note pointing you
back to the project to refine it — so the slide header never balloons
into a paragraph block.

## Help-widget chats and new tickets now show up in our Slack

When you message us from the Help widget, or open a support ticket, it
now lands in the right Axal team Slack channel automatically — chats in
the Founders channel, tickets in the Review channel. We'll see and
respond faster. Nothing changes on your end.

## See exactly which Spin-Out deck slides will fill — before you click

When you pick the Axal VC Spin-Out template and hit "Fill from project",
you now see a grid of 14 small cards — one per slide. Each card shows a
green or red dot, the part of the Lab the slide reads from, and a count
like "3/5 interviews", "0 holders" or "score: ✓". Red cards point you
straight at the Lab tool you still need to open before pitching; green
cards tell you the slide will populate cleanly. The grid only appears
for the Spin-Out template — every other deck template works exactly as
before.

## Axal Spin-Out demo-day deck slides feel like a finished pitch from day one

Every visual slide in the Spin-Out demo-day deck has been rebuilt with
a two-column layout — your story on the left, a designed illustration
or chart anchor on the right. The cover, problem, market, solution,
brand, venture-readiness score, team, mentors, cap table and ask slides
all now hold their shape with no empty space, whether you've filled in
the Lab fields yet or not. As you log interviews, set TAM/SAM/SOM,
seed your cap table or set a raise amount, the placeholders quietly
swap in for your real numbers without the slide jumping around. The ask
slide now leads with "What we are raising — and what it buys."

## Axal Spin-Out demo-day deck no longer has blank chart areas

The Spin-Out demo-day pitch deck used to leave large empty spaces on
slides where your project hadn't yet filled in market sizing, OKRs,
venture-readiness score, cap table or use-of-funds. Those spots now
show a clean, designed placeholder chart — a dashed market-circle
diagram, ghost kanban cards, dashed score bars, an empty donut, a
striped funds bar — so the deck always reads as a complete pitch even
on day one of the Lab. As you fill in your project, the placeholders
swap in for the real numbers without changing the slide layout.

This is the first step of a wider deck refresh; the slide layouts
themselves get their visual upgrade in the next release.


## Telegram drafts stay put, and "Open" actually opens them

Two annoyances in the admin Telegram page are fixed:

- After running the aggregator, your drafts now stay visible when you
  switch tabs and come back — no more having to re-run just to see them.
- Clicking "Open" on a draft now jumps straight into the Compose view
  with that draft loaded, even for older drafts that had piled up.


## Pitch-deck PDF and PowerPoint exports now actually work

Downloading a pitch deck as PDF or PowerPoint now produces a file that
looks exactly like what you see in the editor — same layout, same
colors, same images — instead of failing with an error or giving you a
plain text outline. The PowerPoint version captures each slide as a
full-bleed image with the slide's text content tucked into the speaker
notes, so it opens cleanly in Keynote, Google Slides, or PowerPoint
itself. The old "PNG (cover)" option has been retired — PDF and
PowerPoint cover what people actually asked for.

## Easier: a one-click jump from the Lab to your Demo Day deck

The Spin-Out Lab dashboard now shows a "Generate your Demo Day deck"
button whenever your pitch deck milestone is still open, and stays
visible all through Week 4 so it's there when you actually need it.
Clicking it drops you straight into the pitch-deck builder with the
new 14-slide Demo Day template already applied — no scrolling through
the template picker. Once your deck exists, the button quietly
relabels to "Open Demo Day deck" so you can come back and refresh it.

## Pick which interview quotes show up on your Demo Day deck

Each discovery interview now has a small star button. Star the
interviews you most want to highlight, and the "Early signal" slide on
your Demo Day deck will use those quotes instead of just the three most
recent ones. Leave everything unstarred and the deck behaves exactly
like before — newest three win.

## New: a Demo Day pitch deck made for Spin-Out Lab graduates

There's a 13th template in the pitch-deck picker: **Axal VC 30-day Spin-Out
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
