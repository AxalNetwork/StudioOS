# Public site artwork

Public site images are copied into the Worker’s static build, so every file
here ships on `axal.vc` and `app.axal.vc`. Each file has a row in the rights
record below. A file without a row does not belong here (see "Adding a file").

## LinkedIn assets (D1355)

These are unmodified official downloads; provenance and usage rules are in D1355.

| File | Purpose |
| --- | --- |
| `linkedin-in-blue.png` | Official blue standalone bug for light surfaces. |
| `linkedin-in-white.png` | Official white standalone bug for dark or LinkedIn-blue surfaces. |
| `linkedin-signin-default.png` | Official retina sign-in button, default. |
| `linkedin-signin-hover.png` | Official retina sign-in button, hover. |
| `linkedin-signin-active.png` | Official retina sign-in button, active. |

## Site illustrations: rights record (#5514)

**Origin, for all 26 files.** Twenty-four arrived with the public-site Claude
Design artifact `QAG7sVsvni2VFiyMNdMsZm` (D673, #1546) and were converted to
WebP. The canvas `design/canvases/integrated/Spin-Out Lab Page.dc.html` carried
two more inline, which D678 moved here: `lab-board-1.webp` and
`lab-board-2.webp`. `lab-board-2.webp` is the same picture as
`frontend/public/axal-vc-future.png`. No file carries embedded metadata (no
EXIF, XMP or C2PA) that names a creator.

**Rights status: unconfirmed.** The intake chain shows where each file came
from, not who holds the rights or on what basis we use it. Until the owner
answers on #5514, every row below reads *Unconfirmed* for rights holder and
basis. The audit found missing evidence, not an infringement.

| File | Size | Shown on | Rights holder | Basis | Restrictions | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `home-hero.webp` | 1100×733 | Landing hero; Pricing, Docs and Learning headers (`LandingPage`, `PricingPage`, `DocsLayout`, `LearningHome`) | Unconfirmed | Unconfirmed | None known | D673 |
| `lane-founders.webp` | 1400×600 | Landing lanes; audience doors (`lib/siteDoors.js`) | Unconfirmed | Unconfirmed | None known | D673 |
| `lane-investors.webp` | 1400×600 | Landing lanes; audience doors | Unconfirmed | Unconfirmed | None known | D673 |
| `lane-partners.webp` | 1400×600 | Landing lanes; audience doors | Unconfirmed | Unconfirmed | None known | D673 |
| `lane-advisors.webp` | 1400×600 | Landing lanes; audience doors | Unconfirmed | Unconfirmed | None known | D673 |
| `lab-band.webp` | 1100×733 | Landing Lab band; phone header (`ui/phone/PhoneHeader.jsx`) | Unconfirmed | Unconfirmed | None known | D673 |
| `door-founders.webp` | 1400×933 | Landing closing band; default CTA band (`SiteBlocks.jsx`) | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-discovery.webp` | 420×280 | Landing tools; module map lightbox (`ModuleMapLightbox.jsx`) | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-scoring.webp` | 420×420 | Landing tools; module map lightbox | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-profiling.webp` | 420×420 | Landing tools; module map lightbox | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-market.webp` | 420×384 | Landing tools; module map lightbox | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-incorporate.webp` | 420×280 | Landing tools; module map lightbox | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-captable.webp` | 420×420 | Landing tools; module map lightbox | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-capital.webp` | 420×384 | Landing tools; module map lightbox | Unconfirmed | Unconfirmed | None known | D673 |
| `tool-pitch.webp` | 420×280 | Landing tools; module map lightbox | Unconfirmed | Unconfirmed | None known | D673 |
| `method-system.webp` | 1000×429 | Methodology (`lib/siteMethod.js` → `MethodologyPage`) | Unconfirmed | Unconfirmed | None known | D673 |
| `method-loop.webp` | 1000×429 | Methodology | Unconfirmed | Unconfirmed | None known | D673 |
| `method-lean.webp` | 1000×429 | Methodology | Unconfirmed | Unconfirmed | None known | D673 |
| `method-design-sprint.webp` | 1000×429 | Methodology | Unconfirmed | Unconfirmed | None known | D673 |
| `method-agile.webp` | 1100×471 | Methodology | Unconfirmed | Unconfirmed | None known | D673 |
| `method-kanban.webp` | 1100×471 | Methodology | Unconfirmed | Unconfirmed | None known | D673 |
| `method-lab-28.webp` | 1100×471 | Methodology | Unconfirmed | Unconfirmed | Bakes in the 28-day claim; replacing the claim means replacing the picture | D673 |
| `ead-hero.webp` | 1400×788 | Intelligence (`pages/site/IntelligencePage.jsx`) | Unconfirmed | Unconfirmed | None known | D673 |
| `ead-map.webp` | 1400×600 | Intelligence | Unconfirmed | Unconfirmed | None known | D673 |
| `lab-board-2.webp` | 1536×1024 | Spin-Out Lab hero (`components/spinout/LabIntro.jsx`) | Unconfirmed | Unconfirmed | None known | D678; same picture as `/axal-vc-future.png` |
| `lab-board-1.webp` | 96×92 | **No page.** Only the Spin-Out Lab canvas draws it, as the Axal VC mark at 22px | Axal VC (own mark) | Own brand | None | D678 |

**Duplicates and variants.** No two files are byte-identical. `lab-board-2.webp`
is a WebP copy of `/axal-vc-future.png`, which `TeamPage`,
`SpinoutLabInvestorPage` and the fund brief PDF use. Its rights answer covers
both. The four `lane-*` files and the eight `tool-*` files are sets drawn in one
style, so one answer should cover each set.

**Counts today.** 26 site illustrations: 1 verified (`lab-board-1.webp`, the
Axal VC mark), 25 unconfirmed, 0 replaced, 0 removed. `lab-board-1.webp` ships
in the build but no page shows it. It stays only because the canvas
references it.

## Adding a file

1. Put the file here only if a page renders it. A file only a canvas draws
   belongs beside the canvas in `design/`.
2. Add a row above in the same commit: what it shows, where, who holds the
   rights, the basis (own work, commissioned with assignment, licence and its
   name, generated under a tool's terms), restrictions or attribution, and
   where the evidence is kept. A private licence may be cited by where it is
   held, without its text.
3. If a picture carries a product claim (a number, a duration, a name), say so
   under Restrictions, so changing the claim finds the picture.
4. Reuse an existing row's evidence when the file is a variant of one already
   recorded, and say which.
