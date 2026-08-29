# components/brand/templates — landing-page template previews

One React preview per brand template, rendered in the picker and the editor on
`SpinoutLabBrandPage` and `BrandBuilderPage`.

Each preview reads `data.content` from the shared content model
(`frontend/src/lib/brand/templateContent.js`) — the same object the worker
renders the published page from. That is the point: what the founder sees in the
editor is driven by the same data as what ships.

## Rules

- **A preview is real, not a thumbnail.** These used to be placeholder boxes;
  a test now fails if one degrades back into a stand-in.
- **Provenance is tracked.** `TEMPLATE_SOURCES` records which templates were
  ported from a design source and which are original. A template that claims a
  source it does not have fails the registry test — that check exists because
  one template once carried fabricated provenance.
- Adding a template means: a preview here, a renderer in the worker, and a
  registry entry. All three, or the drift test fails.
