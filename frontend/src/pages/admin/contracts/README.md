# Contracts

D647: one desk at `/admin/contracts` in both admin shells, built from K1–K8
in the Ops canvas. Agreements use counted Worker paging; the wizard uses
recorded published snapshots. Document types retains the D622 Super Admin
gate, pending drafts, reasons and fresh sign-in. `parts.jsx` distinguishes
loading, unreadable, missing and recorded values and owns drawer/PDF helpers.

No fixture figures belong in product rendering. New reads must expose failures
and use mounted Worker routes. Template publication requires migration 434.

D713: Partner deals has a Settlements button per deal, opening
`SettlementsDesk.jsx`. An Admin drafts, edits and deletes drafts; Issue and
Void are drawn only for the Super Admin. Nothing in it moves money.

D717 (#1855): `FundStructureSheet.jsx` is the "Structure of the Fund" sheet. It
opens on `?sheet=structure` from the desk header's door, on every tab, and reads
`GET /api/admin/fund-structure` only once it opens. HQ only: a branch gets no
door. The Super Admin also gets a "Bank accounts" link to the registry's console.
`FundStructureMap.jsx` draws the Worker's `map` as given, paths and text only.

D717 (#1851): Templates (`?tab=templates`) is the L9 catalog.
`TemplateCatalog.jsx` draws the toolbar (search, layer, the five state
segments), the layer sections of cards with their page-1 thumbnails (four at a
time, `frontend/src/lib/thumbnailQueue.js`) and the "Not in the catalog" group.
`FundIDocumentsPanel.jsx` is the Fund I documents panel, in signing order.
`PushResults.jsx` reports Push to branches per branch: Reached, Failed or Not
reached. On a branch Worker the tab is read-only.
