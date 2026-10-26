# frontend/src/pages/admin/productTesting — HQ › Platform › Product testing

The Super Admin's Product testing page at `/admin/platform/product-testing` (D1195, #2382), built to the owner's canvas: `design/incoming/Product Testing Page.dc.html` and `design/incoming/Product testing · Boards.dc.html` (TST1–TST16).

| File | What it is |
|---|---|
| `productTestingModel.js` | Pure: the five tabs and their addresses, `viewOf` (the tab, and on a program its uid and sub-tab), the overview figures from the programme list, the tester row without its email, and each block's wait. D1201: the weekly series, the profile bars and Mail reach rows from D1196's read, Needs you, the tab counts and the rail's line. |
| `ProductTestingTabs.jsx` | The new tabs' bodies: Overview (tiles, places bars, status chips; D1201's weekly, by-profile and Mail reach charts with View as table, Needs you and the rail's line), one program (details, HQ's own applicants), Applicants and the Tester pool. `ProductTestingTabBody` picks one from the address. `useTestingReads` is the page's two shared reads: the header's tab counts and the Overview's tiles draw from the same answers. |

## Where the page lives

`ProductTestingHqPage` in `../ConsolePages.jsx` is the page: the shared header with the tabs as literal `HeaderTab` doors, over `ProductTestingTabBody`. Review and Programs are D815's console (`../consoles/ProductTestingConsole.jsx`), Review in its `review` view. `App.jsx` routes the page and its sub-paths behind `hqOnly`.

## The rules for adding here

- **Every block draws a read on `main` or says "Not read here yet"** with its reason from `WAITS`. A value nobody recorded says "Not recorded", never 0; a measured 0 is fine.
- **Never an email address.** The tester read carries one; nothing here draws it.
- **One failed read costs one block,** never the page.
- A new tab is a `TABS` entry, a literal `HeaderTab` in `ConsolePages.jsx`, and a branch in `ProductTestingTabBody`.
