# `frontend/src/pages/programs/content/` — each program's page and slides (D6966)

One file per program, `<key>.js`, the same key as its `../catalog/<key>.js`.
Each default-exports `{ sections, next, panel, cover, slides, closing }`: the
page's sections 1 to 4 in their fixed order, the Next step band, the fixed
availability panel, and the PDF's slides, written in the kit's block
vocabulary (`../kit.jsx` `Block`, `../deck.js` `slideBlock`).

## Rule for adding to it

Follow "Add a program" in `../README.md`. Every fact comes from a source on
main; a value with no store says "Not recorded". The page and the PDF tell one
story, and the PDF reads nothing live. After a change, rebuild the PDF with
`node scripts/build-program-briefs.mjs <key>`.
