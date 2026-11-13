# frontend/src/pages/admin/productTesting — HQ › Platform › Product testing

The Super Admin's Product testing page at `/admin/platform/product-testing` (D1195, #2382), built to the owner's canvas: `design/incoming/Product Testing Page.dc.html` and `design/incoming/Product testing · Boards.dc.html` (TST1–TST16).

| File | What it is |
|---|---|
| `productTestingModel.js` | Pure: the five tabs and their addresses, `viewOf` (the tab, and on a program its uid and sub-tab), the overview figures from the programme list, the tester row without its email, and each block's wait. D1201: the weekly series, the profile bars and Mail reach rows from D1196's read, Needs you, the tab counts and the rail's line. |
| `ProductTestingTabs.jsx` | The new tabs' bodies: Overview (tiles, places bars, status chips; D1201's weekly, by-profile and Mail reach charts with View as table, Needs you and the rail's line), one program (D1203: the stepper, four stats, details, applicants and Activity), Applicants (D1203: every application, TST8) and the Tester pool (D1204: chips, the by-profile chart, search, filters, sort, pages, the ⋯ menu into D1042's dialogs, and its empty, loading, failed and partial states; on a phone one program's applicants are cards with a ⋯ sheet and their answers full screen). `ProductTestingTabBody` picks one from the address. `useTestingReads` is the page's two shared reads: the header's tab counts and the Overview's tiles draw from the same answers. |
| `programModel.js` | Pure (D1203, #3153): one program's stepper from the history, its four stats, details and review lines, Activity in words, the applicants table's filters, search and sort, and TST8's chips, rows and range. |
| `reviewModel.js` | Pure (D1202, #3152): the ⋯ menu per owner and status (`menuFor`), the dialogs A–H (`dialogFor`), who was told in counts (`toldLine`), Programs' search, filters, sort and pager (`programsView`), and Review's earlier-programmes and sent-back lines. |
| `ActionMenu.jsx` | D1204 (#3154): one ⋯ menu — a dropdown on a desktop, TST16f's bottom sheet below `md` (eyebrow, "Actions", 48px rows, Cancel). Items are links or steps, never a browser pop-up. |
| `ProgrammeLogo.jsx` | A programme's square on Review and Programs: its logo from D1199's `GET /api/testing/programmes/:uid/logo`, else its first letter when there is none or it does not load. |
| `TestingDialog.jsx` | One dialog, A–H, from `dialogFor`: what the step changes, who is told and what is recorded, its field and its one request; a refusal (I) is drawn inside it in the Worker's words. Never a browser pop-up. |

## Where the page lives

`ProductTestingHqPage` in `../ConsolePages.jsx` is the page: the shared header with the tabs as literal `HeaderTab` doors, over `ProductTestingTabBody`. Review and Programs are `../consoles/ProductTestingConsole.jsx`, Review in its `review` view: D815's console as D1202 redraws it, with Review's full cards, Programs' table and the dialogs. New program is the header's action, a lightbox over Programs at `?new=1`. `App.jsx` routes the page and its sub-paths behind `hqOnly`.

## The rules for adding here

- **Every block draws a read on `main` or says "Not read here yet"** with its reason from `WAITS`. A value nobody recorded says "Not recorded", never 0; a measured 0 is fine.
- **Never an email address.** The tester read carries one; nothing here draws it.
- **One failed read costs one block,** never the page.
- **Every change opens a `TestingDialog`,** never a browser pop-up, and offers only the steps `menuFor` allows.
- A new tab is a `TABS` entry, a literal `HeaderTab` in `ConsolePages.jsx`, and a branch in `ProductTestingTabBody`.
