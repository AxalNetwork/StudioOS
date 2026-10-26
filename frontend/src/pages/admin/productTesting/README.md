# frontend/src/pages/admin/productTesting — HQ › Platform › Product testing

The Super Admin's Product testing page at `/admin/platform/product-testing` (D1195, #2382), built to the owner's canvas: `design/incoming/Product Testing Page.dc.html` and `design/incoming/Product testing · Boards.dc.html` (TST1–TST16).

| File | What it is |
|---|---|
| `productTestingModel.js` | Pure: the five tabs and their addresses, `viewOf` (the tab, and on a program its uid and sub-tab), the overview figures from the programme list, the tester row without its email, and each block's wait. |
| `reviewModel.js` | Pure (D1202, #3152): the ⋯ menu per owner and status (`menuFor`), the dialogs A–H (`dialogFor`), who was told in counts (`toldLine`), Programs' search, filters, sort and pager (`programsView`), and Review's earlier-programmes and sent-back lines. |
| `TestingDialog.jsx` | One dialog, A–H, from `dialogFor`: what the step changes, who is told and what is recorded, its field and its one request; a refusal (I) is drawn inside it in the Worker's words. Never a browser pop-up. |
| `ProductTestingTabs.jsx` | The new tabs' bodies: Overview (tiles, places bars, status chips), one program (details, HQ's own applicants), Applicants and the Tester pool. `ProductTestingTabBody` picks one from the address. |

## Where the page lives

`ProductTestingHqPage` in `../ConsolePages.jsx` is the page: the shared header with the tabs as literal `HeaderTab` doors, over `ProductTestingTabBody`. Review and Programs are `../consoles/ProductTestingConsole.jsx`, Review in its `review` view: D815's console as D1202 redraws it, with Review's full cards, Programs' table and the dialogs. New program is the header's action, a lightbox over Programs at `?new=1`. `App.jsx` routes the page and its sub-paths behind `hqOnly`.

## The rules for adding here

- **Every block draws a read on `main` or says "Not read here yet"** with its reason from `WAITS`. A value nobody recorded says "Not recorded", never 0; a measured 0 is fine.
- **Never an email address.** The tester read carries one; nothing here draws it.
- **One failed read costs one block,** never the page.
- **Every change opens a `TestingDialog`,** never a browser pop-up, and offers only the steps `menuFor` allows.
- A new tab is a `TABS` entry, a literal `HeaderTab` in `ConsolePages.jsx`, and a branch in `ProductTestingTabBody`.
