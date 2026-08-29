# frontend/src/data — static reference data

Values that are genuinely constant and belong in the bundle: pricing tiers,
roadmap entries, taxonomy lists.

| File | What it is |
| --- | --- |
| `pricing.js` | Plan tiers as displayed on `/pricing`. |
| `roadmap.js` | Public roadmap entries. |
| `network.js` | Directory categories, programme catalogue, audience/format taxonomies. |
| `productPages.js` | Product-page copy blocks. |
| `investorPipeline.js` | Investor pipeline stage definitions. |

## This is not a fixtures folder

It used to be. Files here once held invented companies, advisors and fund
figures that rendered as real data — a founder's "portfolio" and an advisor's
"practice" were both fiction served from this directory. Those files are gone — fundAnalytics.js, partner/operations.js and
advisor/advisory.js were all deleted — and the surfaces that read them now
read the API.

So: **a record that represents a person, a company, or money does not belong
here.** If a page needs one, it comes from the worker; if the worker has none,
the page says so. Several tests exist purely to keep this folder from becoming
a fixture heap again.
