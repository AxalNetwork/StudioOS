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

D717 (#1852): `TemplateEditor.jsx` is the template editor, opened in place on
the Templates tab: the Markdown source with numbered lines and highlighted
merge fields, the live paper scrolling with it, the merge fields with who
fills each, Kind and Axal VC party, Save draft and Publish v[N]. It is
read-only on a branch Worker. `PublishDialog.jsx` asks before publishing one
template or withdrawing a stub's publication, and prints the Worker's refusal.

D717 (#1853): `PdfPages.jsx` is the page viewer: a PDF drawn one page at a time on
a canvas with pdf.js (pinned `pdfjs-dist`, legacy build, loaded only when it
mounts), "Page X of Y", Previous and Next, and pinch-to-zoom on touch; the only
file that names `pdfjs-dist`. `DraftPages.jsx` is the editor's Pages pane: the
unsaved draft's PDF from `render.pdf`, drawn on opening and on Redraw pages,
never per keystroke. `VersionCompare.jsx` is Compare versions: any two versions,
or one and the draft, as Markdown text with `<del>` and `<ins>`; Restore copies
a body into the draft and saves nothing, and is hidden on a branch.
