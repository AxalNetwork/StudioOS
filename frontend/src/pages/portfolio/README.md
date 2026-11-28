# Portfolio v2 frame and shared patterns

<!-- index: none -->

The investor's Portfolio v2 (D4817), drawn to `design/incoming/Portfolio v2
Page.dc.html` and its boards. Every Portfolio board draws in one frame,
`PortfolioFrame.jsx`, with the parts built once in `PortfolioParts.jsx` and the
pure model in `portfolioModel.js`; the boards themselves live in
`../investor/` (`InvestorPortfolioCanvas.jsx` at `/portfolio`, and its
siblings) and draw here through `PortfolioWorkspace`. A board adds to the shared
model, never a second one, and keeps its own pure model (`*Model.js`) beside the
component that draws it and its styles (`*.css`) on the frame's tokens,
redefined under `.dark`.

## Where each part is described

This README lists no files and holds no per-part notes (D6472, #6472). A file
says what it is in its own header comment. What each board or feature built,
and the files it added, is in its decision under
`documentation/architecture/decisions/`: `D4817.md` and its parts
`D4817-p<k>.md` for the Portfolio v2 boards, and each later feature's own
`D<n>.md` or `D<n>-p<k>.md`. A new part writes its decision file and edits
nothing here.

## Rules

- A failed read reads **Unreadable** with a Retry for that source alone; a
  read that answered with nothing reads **Not recorded** with its reason; a
  measured zero stays 0. Never a zero or an empty book for a failure.
- No issue number, decision id or build-phase name in member copy (#5365 F-09).
- The rail's structure is #5130's; the Account-menu move is #4473's. The frame
  places the rail and links Portfolio's own routes, and changes neither.
