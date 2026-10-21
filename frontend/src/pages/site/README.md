# Site: the public website's pages

The pages built to the owner's website canvas
(`design/canvases/integrated/Axal VC Website.dc.html`) under epic #1546 (D673).
Every one renders inside `SitePage` (`frontend/src/components/site/SitePage.jsx`),
which carries the nav, the footer, the light theme and the page meta, and
builds from the shared blocks in `frontend/src/components/site/SiteBlocks.jsx`.
`frontend/src/App.jsx` routes them; `frontend/src/lib/siteLinks.js` is the one
link list the nav, the burger menu and the footer read.

| File | Route | Decision |
| --- | --- | --- |
| `DoorPage.jsx` | the four doors, `/for-founders`, `/for-investors`, `/for-service-partners`, `/for-advisors` | D676 |
| `FirmPage.jsx` | `/about` | D677 |
| `PlatformPage.jsx` | `/platform` | D677 |
| `AdministratorsPage.jsx` | `/administrators` | D677 |
| `MethodologyPage.jsx` | `/methodology` | D678 |
| `IntelligencePage.jsx` | `/intelligence`, from the public model read | D678 |
| `ResourcesPage.jsx` | `/resources`, the Network overview | D679 |
| `LegalDocument.jsx` | the frame `/terms`, `/privacy` and `/risk-disclosures` share | D680 |
| `NewsletterPage.jsx` | `/newsletter`, the signup with the six public topics (board W1) | D813 |
| `NewsletterConfirmPage.jsx` | `/newsletter/confirm?token=`, confirmed, expired and used links (W2) | D813 |
| `NewsletterPreferencesPage.jsx` | `/newsletter/preferences?token=`, the topics, Save, unsubscribe and Resubscribe, no sign-in (W3) | D813 |
| `newsletterModel.js` | the newsletter pages' words and rules, pure; the topics are migration 515's | D813 |

The Network section's other pages (Articles, the Directory, Events, Circles,
Jobs) and Contact were rebuilt in their existing files under
`frontend/src/pages/`; the legal pages keep theirs too.

Each group's styles are one stylesheet here, imported by its pages:
`doors.css`, `firm.css`, `method.css`, `network.css`, `network2.css` and
`contact.css`; the newsletter's is `frontend/src/components/site/newsletter.css`, beside the
signup block `SitePage` draws above every footer (D813). The page copy is the owner's and lives in `frontend/src/lib/`
(`siteDoors.js`, `siteFirm.js`, `siteMethod.js`, `siteIntelligence.js`,
`siteResources.js`, `siteNetwork2.js`).

## The rule for adding here

- A page here draws live data from the API or the owner's copy, never a
  canvas example. A figure, person, job or event the API does not return is
  not drawn.
- A claim about the product is true of the code, or it is dropped.
- CSS sets no `font-family` but `inherit` or `var(--font-mono)`; the display
  face comes from `site.css`. The public site is light only.
- A new public route also goes in `isPublicPath`, the OG registry and the
  sitemap; `frontend/test/site_routes_d673.test.mjs` checks all three.
