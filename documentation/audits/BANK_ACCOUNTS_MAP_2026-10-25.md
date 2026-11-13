# Bank accounts map — 2026-10-25

The owner's "Bank Accounts" canvas (#2389, boards BNK1–BNK12), read against the code on `origin/main` at `6c665204ce`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1181.

## 1. The canvas

`design/incoming/Bank accounts · Boards.dc.html` holds the board grid, which imports `Bank Accounts Page.dc.html`.

| Boards | What they draw |
|---|---|
| BNK1 | Accounts for the Super Admin: the entity cards, each account joined to its Mercury balance, the payments card |
| BNK2 | One account's lightbox: its details, how a notice prints it, its transactions |
| BNK3–BNK4 | Cash, light and dark: balance over time, money in and out, the unmatched-receipts tile |
| BNK5 | History: reveals and changes |
| BNK6–BNK7 | The dialogs (Add, Relabel, Change payments, Retire, Reveal, Mercury); entity card states |
| BNK8–BNK12 | Empty, loading, error and partial, no permission, phone |

## 2. #2389's missing items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | The Admin Console title and dropdown | **Fixed by D938:** `AdminPageHeader`, no console shell |
| 2 | No slug | **Fixed by D938:** `/admin/platform/bank-accounts`; D1181 adds `/cash` and `/history` |
| 3 | Any admin opens it | **Fixed by D938:** `hqOnly`; an Admin gets the Super-Admin sentence |
| 4 | No balances | **Fixed by D1181** on Cash, from Mercury's read; Accounts' join is part 3 and part 4 |
| 5 | Registry and Mercury not joined | **Open** (part 3) |
| 6 | No history | **Open:** the reveal ledger has no reader (part 1) |
| 7 | Inline forms, not dialogs | **Open** (part 4) |
| 8 | No notice preview | **Open** (part 3) |
| 9 | Unmatched receipts are a sample | **Open** (part 5) |
| 10 | Copy and labels | **Open** (part 4) |
| 11 | No rail | **Open** (part 4) |
| 12 | One fund only | Kept: owner question 4 |

## 3. What each tab can read today

| Tab | Read | Drawn by D1181 |
|---|---|---|
| Accounts | registry and connections | As today |
| Cash | `GET /api/admin/mercury/accounts` | The entity accounts with Current, Available, when read and Registry; balance over time and money in and out Not read here yet |
| History | none | Not read here yet |

## 4. What waits, and on what

- **Worker reads** (parts 1–3) start now. None needs a migration.
- **The frontend** (parts 4–6) follows them.
